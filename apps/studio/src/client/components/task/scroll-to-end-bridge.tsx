import { type RefObject, useLayoutEffect } from "react";

import { useMessageScroller } from "../ui/message-scroller";

/** How long the transcript may go without growing before its end counts as reached. */
const SETTLE_MS = 250;

/** How long the end is followed after arriving, at most, however long the transcript keeps growing. */
const SETTLE_MAX_MS = 4000;

/** The reader taking over: any of these on the viewport ends the following. */
const TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * Takes the transcript to its end on arriving, and holds it there while what
 * arrived settles.
 *
 * Renders nothing: the scroll commands come from the provider's context, so
 * they are only reachable below it, and the submit handler that also wants
 * the end sits above. A changing `signal` rather than a direct call, so the
 * scroll runs from the render that turned autoScroll on and the scroller arms
 * follow-bottom with it.
 *
 * Arriving is not one moment. The messages are read after the conversation
 * mounts, and a long transcript lays out for a while after they land: images
 * size themselves, cards fetch what they show, Markdown finishes. On a thread
 * at rest nothing else follows the end, so the end taken once is short of the
 * end by everything that laid out after. The content is watched instead, and
 * the end taken again each time it grows, until it has held still for a
 * moment or the reader has moved, whichever is first.
 */
export function ScrollToEndBridge({
  contentRef,
  signal,
}: {
  /** The scroller's content, whose growth is what arriving looks like. */
  contentRef: RefObject<HTMLElement | null>;
  /** Changes whenever the end should be taken afresh: the session, its messages arriving, a submit. */
  signal: string;
}) {
  const { scrollToEnd } = useMessageScroller();

  useLayoutEffect(() => {
    scrollToEnd();
    const frame = requestAnimationFrame(() => {
      scrollToEnd();
    });

    const content = contentRef.current;
    const scrolled = content?.parentElement;
    if (!content || !scrolled) {
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    // Narrowed once here, since the narrowing does not reach into `stop`.
    const viewport: HTMLElement = scrolled;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      scrollToEnd();
      clearTimeout(quiet);
      quiet = setTimeout(stop, SETTLE_MS);
    });
    observer.observe(content);
    quiet = setTimeout(stop, SETTLE_MS);
    const cap = setTimeout(stop, SETTLE_MAX_MS);
    // The reader taking the wheel is the reader saying where to be.
    for (const type of TAKEOVER_EVENTS) {
      viewport.addEventListener(type, stop, { passive: true });
    }
    // Hoisted: the observer and the timers name it before it is reached.
    function stop() {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      for (const type of TAKEOVER_EVENTS) {
        viewport.removeEventListener(type, stop);
      }
    }
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [contentRef, scrollToEnd, signal]);

  return null;
}
