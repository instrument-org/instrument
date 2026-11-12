import { alarms } from "@instrument-org/shared/alarms";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";

/** How long after closing a page for its sound the alarm looks again. */
export const STRAY_SOUND_CHECK_MS = 10_000;

/**
 * Closes a page a tab has stepped away from once it makes sound.
 *
 * A tab keeps the page it left (back from a page to a file, a file opened
 * over a page) as a step of its history, with the page's guest parked out of
 * sight. Chromium freezes only a page it counts as hidden, which a parked
 * guest never is, so the page plays on with nothing on screen to stop it.
 * Closing it is what discard does: the tab keeps the address and loads it
 * again when it steps back. A page still playing a while after its close
 * means the close did not take, which the alarm reports.
 */
export function createPutAwaySound({
  close,
  describe,
  gate = alarms,
  info,
  isAudible,
  isPutAway,
  later = (run, ms) => {
    setTimeout(run, ms);
  },
  warn,
}: {
  close: (targetId: BrowserTargetId) => void;
  /** The page's site, for the log; never its whole address. */
  describe: (targetId: BrowserTargetId) => string;
  gate?: Pick<typeof alarms, "raise">;
  info: (line: string) => void;
  /** Whether the page makes sound, muted or not (`isCurrentlyAudible`). */
  isAudible: (targetId: BrowserTargetId) => boolean;
  isPutAway: (targetId: BrowserTargetId) => boolean;
  later?: (run: () => void, ms: number) => void;
  warn: (line: string) => void;
}): (targetId: BrowserTargetId) => void {
  return (targetId) => {
    if (!isPutAway(targetId) || !isAudible(targetId)) {
      return;
    }
    const site = describe(targetId);
    info(
      `Closed a page a tab stepped away from, as it was playing sound (${site})`,
    );
    close(targetId);
    later(() => {
      if (isPutAway(targetId) && isAudible(targetId)) {
        gate.raise(
          "browser:stray-sound",
          () =>
            `Stray sound: a page a tab stepped away from still plays ${STRAY_SOUND_CHECK_MS / 1000}s after it was closed (${site})`,
          warn,
        );
      }
    }, STRAY_SOUND_CHECK_MS);
  };
}
