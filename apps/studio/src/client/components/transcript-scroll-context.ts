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

// The room left above a turn brought to the top, on top of the content's own
// 16px of padding, so the last few rows of what came before stay in sight and a
// send does not read as arriving in a new chat. That is 96px in all, of which a
// finished reply's footer and the gap under it take about 55px, leaving its last
// two lines with the upper one in the transcript's 24px top fade.
export const TRANSCRIPT_PREVIOUS_TURN_PEEK = 80;

// Where a reply's first line stops, measured from the top of the viewport.
const REPLY_START_ROOM = 40;

/**
 * Puts a reply's first line back under the top of the window when following its
 * end has carried it above, and says whether it did.
 *
 * Measured in offsets, which leave out the arrival's own scale and the
 * viewport's scroll, so the row's place in the transcript is where it settles
 * rather than where its first frame draws it.
 */
export function holdAtReplyStart(row: HTMLElement): boolean {
  const viewport = row.closest<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  if (!viewport) {
    return false;
  }
  const top = layoutTop(row) - layoutTop(viewport) - viewport.clientTop;
  const target = top - REPLY_START_ROOM;
  if (viewport.scrollTop <= target) {
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
