import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { holdAtReplyStart } from "../transcript-scroll-context";

const SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);
const READER_INPUTS = ["wheel", "touchmove", "keydown", "pointerdown"];

/**
 * Holds a trailing reply at its first line, and follows again if work or a card
 * arrives after it. Reader input or opening a row gives the reader ownership of
 * that hold. Each reply is held once, and a reply present on arrival is left at
 * its end. The returned release hands scrolling to the reader explicitly.
 */
export function useHoldAtReplyStart({
  contentRef,
  isFollowing,
  release,
  resume,
}: {
  contentRef: RefObject<HTMLElement | null>;
  isFollowing: boolean;
  release: () => void;
  resume: () => void;
}) {
  const automaticHold = useRef<HTMLElement | null>(null);
  const latest = useRef({ isFollowing, release, resume });
  useLayoutEffect(() => {
    latest.current = { isFollowing, release, resume };
  });
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const lastReply = () => {
      return content.querySelector<HTMLElement>('[data-reply-tail="true"]');
    };
    const lastSent = () => {
      const sent = content.querySelectorAll('[data-scroll-anchor="true"]');
      return sent[sent.length - 1];
    };
    let held = lastReply()?.dataset.replyRow;
    let correction = 0;
    const check = () => {
      const reply = lastReply();
      const sent = lastSent();
      const beforeSent = (row: HTMLElement) =>
        sent &&
        row.isConnected &&
        row.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING;
      const previous = automaticHold.current;
      if (previous && previous !== reply) {
        automaticHold.current = null;
        cancelAnimationFrame(correction);
        // A new message has its own anchor and send animation.
        if (!beforeSent(previous)) {
          latest.current.resume();
        }
        return;
      }
      const id = reply?.dataset.replyRow;
      if (!reply || id === held || !latest.current.isFollowing) {
        return;
      }
      // A reply above the message just sent is a finished turn's, and holding
      // at it would scroll back past the message.
      if (beforeSent(reply)) {
        return;
      }
      if (holdAtReplyStart(reply)) {
        held = id;
        automaticHold.current = reply;
        latest.current.release();
        // The scroller may have one more move of its own queued for this frame.
        correction = requestAnimationFrame(() => {
          if (automaticHold.current === reply && lastReply() === reply) {
            holdAtReplyStart(reply);
          }
        });
      }
    };
    // On scrolling too: the scroller moves to the new end after the growth, and
    // a reply's last words may be the last growth there is.
    const viewport = content.closest("[data-slot='message-scroller-viewport']");
    const observer = new ResizeObserver(check);
    observer.observe(content);
    // A same-height row can replace the reply without a resize.
    const mutations = new MutationObserver(check);
    mutations.observe(content, {
      attributeFilter: ["data-reply-tail"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const onReaderInput = (event: Event) => {
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) {
        return;
      }
      if (event.type === "pointerdown" && event.target !== viewport) {
        return;
      }
      automaticHold.current = null;
      cancelAnimationFrame(correction);
    };
    for (const type of READER_INPUTS) {
      viewport?.addEventListener(type, onReaderInput, { passive: true });
    }
    viewport?.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(correction);
      automaticHold.current = null;
      for (const type of READER_INPUTS) {
        viewport?.removeEventListener(type, onReaderInput);
      }
      viewport?.removeEventListener("scroll", check);
    };
  }, [contentRef]);

  return () => {
    automaticHold.current = null;
    latest.current.release();
  };
}
