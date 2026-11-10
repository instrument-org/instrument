import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { holdAtReplyStart } from "../transcript-scroll-context";

/**
 * Stops following a trailing reply when its first line reaches the top of the
 * window, so a reply taller than the window is read from its start. Each reply
 * is held once, and a reply present on arrival is left at its end.
 *
 * Whatever is drawn after a held reply leaves the reader where they are and
 * calls `onArrivedBelow`, for the jump button to say there is more below. A
 * message just sent is the exception: it brings itself into view.
 */
export function useHoldAtReplyStart({
  contentRef,
  isFollowing,
  onArrivedBelow,
  release,
}: {
  contentRef: RefObject<HTMLElement | null>;
  isFollowing: boolean;
  onArrivedBelow: () => void;
  release: () => void;
}) {
  const latest = useRef({ isFollowing, onArrivedBelow, release });
  useLayoutEffect(() => {
    latest.current = { isFollowing, onArrivedBelow, release };
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
    // The reply the hold stopped at, by id, while nothing is drawn after it.
    // An id rather than the element, since a row can be drawn again as its
    // turn settles.
    let holding: string | undefined;
    let correction = 0;
    const check = () => {
      const reply = lastReply();
      const id = reply?.dataset.replyRow;
      const sent = lastSent();
      const beforeSent = (row: Element) =>
        sent !== undefined &&
        Boolean(
          row.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      if (holding !== undefined && holding !== id) {
        const previous = content.querySelector(
          `[data-reply-row="${CSS.escape(holding)}"]`,
        );
        holding = undefined;
        cancelAnimationFrame(correction);
        if (!previous || !beforeSent(previous)) {
          latest.current.onArrivedBelow();
        }
        return;
      }
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
        holding = id;
        latest.current.release();
        // The scroller may have one more move of its own queued for this frame.
        correction = requestAnimationFrame(() => {
          if (lastReply() === reply) {
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
    // A row of the same height can be drawn after the reply without a resize.
    const mutations = new MutationObserver(check);
    mutations.observe(content, {
      attributeFilter: ["data-reply-tail"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    viewport?.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(correction);
      viewport?.removeEventListener("scroll", check);
    };
  }, [contentRef]);
}
