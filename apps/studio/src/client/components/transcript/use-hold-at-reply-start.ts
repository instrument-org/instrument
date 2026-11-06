import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { holdAtReplyStart } from "../transcript-scroll-context";

/**
 * Stops following a reply when its first line reaches the top of the window, so
 * a reply taller than the window is read from its start. Each reply does this
 * once: scrolling down to its end follows again from there. A reply already
 * there when the transcript opens is left alone, since arriving in a chat puts
 * the reader at its end.
 */
export function useHoldAtReplyStart({
  contentRef,
  isFollowing,
  release,
}: {
  contentRef: RefObject<HTMLElement | null>;
  isFollowing: boolean;
  release: () => void;
}) {
  const latest = useRef({ isFollowing, release });
  useLayoutEffect(() => {
    latest.current = { isFollowing, release };
  });
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const lastReply = () => {
      const replies = content.querySelectorAll<HTMLElement>("[data-reply-row]");
      return replies[replies.length - 1];
    };
    const lastSent = () => {
      const sent = content.querySelectorAll('[data-scroll-anchor="true"]');
      return sent[sent.length - 1];
    };
    let held = lastReply()?.dataset.replyRow;
    const check = () => {
      const reply = lastReply();
      const id = reply?.dataset.replyRow;
      if (!reply || id === held || !latest.current.isFollowing) {
        return;
      }
      // A reply above the message just sent is a finished turn's, and holding
      // at it would scroll back past the message.
      const sent = lastSent();
      if (
        sent &&
        reply.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        return;
      }
      if (holdAtReplyStart(reply)) {
        held = id;
        latest.current.release();
        // The scroller may have one more move of its own queued for this frame.
        requestAnimationFrame(() => {
          holdAtReplyStart(reply);
        });
      }
    };
    // On scrolling too: the scroller moves to the new end after the growth, and
    // a reply's last words may be the last growth there is.
    const viewport = content.closest("[data-slot='message-scroller-viewport']");
    const observer = new ResizeObserver(check);
    observer.observe(content);
    viewport?.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("scroll", check);
    };
  }, [contentRef]);
}
