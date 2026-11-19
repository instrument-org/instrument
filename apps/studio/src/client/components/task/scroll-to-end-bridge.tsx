import { useLayoutEffect } from "react";

import { useMessageScroller } from "../ui/message-scroller";

/**
 * Takes the transcript to its end whenever `signal` changes: another session
 * shown in the same scroller. The scroller holds the end from there while what
 * arrived lays out, and opens at the end on its own the first time.
 *
 * Renders nothing: the scroll commands come from the provider's context, so
 * they are only reachable below it. Sending a message is not an arrival: its
 * turn is a scroll anchor, and taking the end here would pull it away from the
 * top of the window.
 */
export function ScrollToEndBridge({
  signal,
}: {
  /** Changes whenever the end should be taken afresh. */
  signal: string;
}) {
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    scrollToEnd();
  }, [scrollToEnd, signal]);
  return null;
}
