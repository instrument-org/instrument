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
 * draft's words without it, makes the write at once; a window going makes
 * them all.
 */

/** How long typing is left alone before it is written into its draft. */
export const WORDS_SETTLE_MS = 300;

const waiting = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; write: () => void }
>();

/** The write to make for a composer once its typing settles, in place of the one waiting. */
export function settleWords(key: string, write: () => void) {
  clearTimeout(waiting.get(key)?.timer);
  waiting.set(key, {
    timer: setTimeout(() => {
      waiting.delete(key);
      write();
    }, WORDS_SETTLE_MS),
    write,
  });
}

/** Makes a composer's waiting write now. */
export function flushWords(key: string) {
  const entry = waiting.get(key);
  if (entry === undefined) {
    return;
  }
  clearTimeout(entry.timer);
  waiting.delete(key);
  entry.write();
}

/** Drops a composer's waiting write, for words that went another way. */
export function cancelWords(key: string) {
  clearTimeout(waiting.get(key)?.timer);
  waiting.delete(key);
}

globalThis.window?.addEventListener("beforeunload", () => {
  for (const key of waiting.keys()) {
    flushWords(key);
  }
});
