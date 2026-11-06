import { noop } from "radashi";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** How long the transcript takes to carry a message just sent up to where it rests. */
const SLIDE_MS = 360;
/** The curve the transcript's other motion moves on: quick to answer, slow to land. */
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Below this there is nothing to see move. */
const SLIDE_MIN_PX = 4;
/** How long a send may take to show its message before it is no longer waited for. */
const WAIT_FOR_MESSAGE_MS = 5000;

/** The keys the scroller takes as the reader scrolling, when the viewport has the keyboard. */
const SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

/** What on the viewport can mean the reader taking over. */
const INPUTS = ["keydown", "pointerdown", "touchmove", "wheel"];

/**
 * Animates the move to a message the person just sent, and only that move:
 * opening a chat, switching back and everything else the scroller does stay
 * jumps.
 *
 * The scroller still pins the message at once, so its spacer and its hold on the
 * message are right from the first frame and nothing below depends on the
 * animation. What animates is a transform on its content, from where the
 * reader's rows were down to nothing: the browser runs that off the main thread,
 * so it keeps moving through the work a send sets off (the composer emptying, the
 * chat's render, the reply starting), and no frame loop is left running.
 *
 * `armRef` is what the send calls, before its message is drawn.
 */
export function useSlideToSent({
  armRef,
  contentRef,
  release,
}: {
  armRef: RefObject<() => void>;
  contentRef: RefObject<HTMLElement | null>;
  /** Hands scrolling to the reader, for the one gesture the scroller cannot see. */
  release: () => void;
}) {
  const latestRelease = useRef(release);
  useLayoutEffect(() => {
    latestRelease.current = release;
  });
  useEffect(() => {
    const content = contentRef.current;
    const viewport = content?.parentElement;
    if (!content || !viewport) {
      return;
    }
    let stop: () => void = noop;
    armRef.current = () => {
      stop();
      stop = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? noop
        : slideToNextSent({
            content,
            release: () => {
              latestRelease.current();
            },
            viewport,
          });
    };
    return () => {
      stop();
      armRef.current = noop;
    };
  }, [armRef, contentRef]);
}

/**
 * Waits for the next sent message to arrive and slides to it. Hands back what
 * stops the wait or the slide, which leaves the rows where they are on screen.
 */
function slideToNextSent({
  content,
  release,
  viewport,
}: {
  content: HTMLElement;
  release: () => void;
  viewport: HTMLElement;
}): () => void {
  const scroller = viewport.parentElement;
  const from = viewport.scrollTop;
  const sentBefore = lastSent(content);
  let slide: Animation | undefined;
  // The scrollTop the slide is landing on.
  let rest = from;
  let settling = 0;

  // The scroller measures with `getBoundingClientRect`, which includes the
  // transform, so a move of its own during the slide (holding the message as the
  // reply grows) lands that much too far. Taken back in the same frame, which
  // leaves the move's spacer and the slide's motion both as they should be.
  const settle = () => {
    if (slide && viewport.scrollTop !== rest) {
      const moved = viewport.scrollTop - offsetOf(content);
      // Within a pixel is the same place, rounded the other way on the way there.
      viewport.scrollTop = Math.abs(moved - rest) <= 1 ? rest : moved;
      rest = viewport.scrollTop;
    }
  };
  // A move anyone else makes (the hold at a reply's start, the browser's own scroll
  // anchoring) measures nothing through the transform, so it stands. These run
  // outside the frames the scroller moves in.
  const noteRest = () => {
    rest = viewport.scrollTop;
  };
  // These observers are made after the scroller's, and each kind is called in the
  // order it was made, so `settle` always follows the scroller's move: a frame
  // asked for here runs after the one it asked for on the same resize, and this
  // mutation callback runs after the one in which it pins.
  const resizes = new ResizeObserver(() => {
    noteRest();
    cancelAnimationFrame(settling);
    settling = requestAnimationFrame(settle);
  });
  const mutations = new MutationObserver(() => {
    if (slide) {
      settle();
    } else if (lastSent(content) !== sentBefore) {
      start();
    }
  });
  mutations.observe(content, { childList: true });
  const giveUp = setTimeout(stop, WAIT_FOR_MESSAGE_MS);

  const onInput = (event: Event) => {
    if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) {
      return;
    }
    if (event.type === "pointerdown") {
      // The press of a scrollbar lands on the viewport itself, and the scroller
      // does not hear of it. One on a row is not scrolling.
      if (event.target !== viewport) {
        return;
      }
      release();
    }
    stop();
  };
  for (const type of INPUTS) {
    viewport.addEventListener(type, onInput, { passive: true });
  }

  function start() {
    clearTimeout(giveUp);
    rest = viewport.scrollTop;
    // From far up there is nothing to keep in view, and a screenful reads as the
    // same motion where thousands of pixels in a third of a second read as a blur.
    const room = viewport.clientHeight;
    const distance = Math.min(Math.max(rest - from, -room), room);
    if (Math.abs(distance) < SLIDE_MIN_PX) {
      stop();
      return;
    }
    scroller?.toggleAttribute("data-sliding", true);
    resizes.observe(content);
    resizes.observe(viewport);
    viewport.addEventListener("scroll", noteRest, { passive: true });
    slide = content.animate(
      { transform: [`translateY(${distance.toString()}px)`, "translateY(0)"] },
      { duration: SLIDE_MS, easing: SLIDE_EASING },
    );
    slide.onfinish = stop;
  }

  // Hoisted: the timeout above and the start of the slide name it before it is reached.
  function stop() {
    clearTimeout(giveUp);
    mutations.disconnect();
    resizes.disconnect();
    cancelAnimationFrame(settling);
    viewport.removeEventListener("scroll", noteRest);
    for (const type of INPUTS) {
      viewport.removeEventListener(type, onInput);
    }
    if (!slide) {
      return;
    }
    const left = offsetOf(content);
    slide.onfinish = null;
    slide.cancel();
    slide = undefined;
    viewport.scrollTop -= left;
    scroller?.toggleAttribute("data-sliding", false);
    // The scroller last worked out what is left to scroll with the transform
    // counted in, and with no scroll or resize coming it would keep that answer.
    viewport.dispatchEvent(new Event("scroll"));
  }

  return stop;
}

function lastSent(content: HTMLElement) {
  const sent = content.querySelectorAll(':scope > [data-scroll-anchor="true"]');
  return sent[sent.length - 1];
}

/** How far the slide has the content from where it rests, this frame. */
function offsetOf(content: HTMLElement) {
  return new DOMMatrixReadOnly(getComputedStyle(content).transform).m42;
}
