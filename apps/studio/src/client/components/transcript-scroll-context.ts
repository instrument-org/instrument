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
