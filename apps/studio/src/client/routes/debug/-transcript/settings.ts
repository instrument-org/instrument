import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * How the transcript page is set up.
 *
 * The split is between what is on screen and how it is being watched. The two
 * switches that change what is on screen -- replay and developer mode -- are
 * plain atoms: they hold across scenarios for as long as the page is open, and
 * then a fresh visit opens on the whole transcript with nothing hidden behind a
 * mode nobody remembers turning on. Both default off for the same reason, which
 * is that reading a transcript is what almost every visit is for; stepping one
 * out is a thing you go and ask for.
 *
 * The knobs that only exist once replay is running are the other kind. They say
 * how to watch rather than what to watch, they are the same answer every time,
 * and having to set them again on every visit is the annoying half of a toggle.
 */

/** How fast replay steps, in frames a second. See `speedAtom`. */
export const SPEEDS = [1, 2, 4, 10, 25];

/** Whether the transcript holds its own end in view as it grows. */
export const autoScrollAtom = atomWithStorage(
  "debug-transcript-auto-scroll",
  true,
);

export const developerModeAtom = atom(false);

/**
 * Whether the transcript arrives a step at a time, or is simply there.
 *
 * Off is the finished transcript, which is what a reopened task shows and the
 * only way to look at a whole one at once. On replays it as it happened, which
 * is the only way to see a row growing, a call waiting its turn, or the column
 * moving under something that has not finished arriving.
 */
export const replayAtom = atom(false);

/**
 * Whether the marker showing where the drawn content ends is drawn, along with
 * how far that moved between one frame and the next.
 */
export const showsBottomEdgeAtom = atomWithStorage(
  "debug-transcript-bottom-edge",
  true,
);

// Named by the rate itself rather than as a multiple: there is no real-time
// pace here to be a multiple of, since a frame is one event and events are not
// evenly spaced in life.
export const speedAtom = atomWithStorage("debug-transcript-speed", 4);
