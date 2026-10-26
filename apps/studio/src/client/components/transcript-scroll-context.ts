import { noop } from "radashi";
import { createContext, useContext } from "react";

/**
 * Hands scrolling back to the reader, for the rows that can grow because the
 * reader asked them to.
 *
 * The scroller cannot tell content a click opened from output the agent
 * produced: while it is following the live end, either one moves the transcript
 * to the bottom, and for a click that means the row under the pointer leaves.
 * Every control in the transcript that opens something calls this first, so the
 * scroller is already out of follow when the rows it opens are measured.
 *
 * A context rather than a prop because the controls are spread through the
 * transcript -- a tool call's own row, a long message's fold, a message's
 * sources -- and only the surface that draws the transcript inside a scroller
 * knows there is one. Outside a scroller (a previewed conversation, a nested
 * tool-agent stream) there is nothing to release, which is the default.
 */
export const TranscriptScrollContext = createContext<() => void>(noop);

export function useReleaseAutoScroll() {
  return useContext(TranscriptScrollContext);
}

// Where a turn brought to the top comes to rest, measured from the top of the
// viewport. Less than the primitive's default, because the transcript fades its
// own top 24px: the previous turn showing through the fade is the whole point
// of the band, and past that it is just a gap above the turn being read.
export const TRANSCRIPT_PREVIOUS_TURN_PEEK = 40;

/**
 * Scrolls a reply that just landed at the end to its first line, when
 * following the end would carry that line out of sight, and says whether it
 * did. A reply that fits is left to the scroller, which shows it whole, and
 * one landing below where the reader scrolled up to is theirs to find.
 *
 * Measured in offsets, which leave out the arrival's own scale and the
 * viewport's scroll, so the row's place in the transcript is where it settles
 * rather than where its first frame draws it.
 */
export function scrollToReplyStart(row: HTMLElement): boolean {
  const viewport = row.closest<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  if (!viewport) {
    return false;
  }
  const top = layoutTop(row) - layoutTop(viewport) - viewport.clientTop;
  const seen = viewport.scrollTop + viewport.clientHeight;
  // A row lands a gap under the old end, and the scroller's own idea of the
  // end has 8px of slack.
  const content = row.closest('[data-slot="message-scroller-content"]');
  const gap = content
    ? Number.parseFloat(getComputedStyle(content).rowGap) || 0
    : 0;
  if (top > seen + gap + 8) {
    return false;
  }
  const target = top - TRANSCRIPT_PREVIOUS_TURN_PEEK;
  if (target >= viewport.scrollHeight - viewport.clientHeight) {
    return false;
  }
  viewport.scrollTop = target;
  return true;
}

function layoutTop(element: HTMLElement) {
  let top = 0;
  for (
    let at: Element | null = element;
    at instanceof HTMLElement;
    at = at.offsetParent
  ) {
    top += at.offsetTop;
  }
  return top;
}
