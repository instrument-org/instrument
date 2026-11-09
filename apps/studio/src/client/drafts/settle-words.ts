/**
 * The words a composer has waiting to be written into its draft.
 *
 * A composer holds what is typed in it, and its draft is written a beat after
 * the typing settles rather than on every key: writing a draft is a trip to
 * main and a file, and the window lays out again for the drafts list and the
 * inbox, which on each keystroke is felt in the keys.
 *
 * One entry per composer, keyed by what it writes into, each the write to
 * make once the typing settles. A send drops its composer's entry, since the
 * send carries the words; a composer going, or anything about to read the
 * draft's words without it, makes the write at once; a window going, or
 * the app quitting, makes them all (`client/lib/before-leaving.ts`).
 */

import { finishBeforeLeaving } from "@/client/lib/before-leaving";

/** How long typing is left alone before it is written into its draft. */
export const WORDS_SETTLE_MS = 300;

const waiting = new Map<
  string,
  {
    leave: () => void;
    timer: ReturnType<typeof setTimeout>;
    write: () => void;
  }
>();

/** The write to make for a composer once its typing settles, in place of the one waiting. */
export function settleWords(key: string, write: () => void) {
  cancelWords(key);
  waiting.set(key, {
    leave: finishBeforeLeaving(() => {
      flushWords(key);
    }),
    timer: setTimeout(() => {
      flushWords(key);
    }, WORDS_SETTLE_MS),
    write,
  });
}

/** Whether a composer has words on their way into its draft. */
export function hasWaitingWords(key: string) {
  return waiting.has(key);
}

/** Makes a composer's waiting write now. */
export function flushWords(key: string) {
  const entry = waiting.get(key);
  if (entry === undefined) {
    return;
  }
  clearTimeout(entry.timer);
  entry.leave();
  waiting.delete(key);
  entry.write();
}

/** Drops a composer's waiting write, for words that went another way. */
export function cancelWords(key: string) {
  const entry = waiting.get(key);
  if (entry === undefined) {
    return;
  }
  clearTimeout(entry.timer);
  entry.leave();
  waiting.delete(key);
}
