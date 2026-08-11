/**
 * A queue per key, so work for one key never overlaps with itself.
 *
 *     same key      -> runs in order, one at a time
 *     different key -> runs independently
 *
 * For a read-modify-write against a file, which is what both task stores do:
 * two overlapping updates each merge onto the state the other has not written
 * yet, and the later write wins outright, dropping the earlier change with no
 * error anywhere. Queueing on the file makes the read and the write one step.
 *
 * Keys are plain strings and each queue owns its own map, so a caller picks
 * whatever identifies the thing it is writing -- a task id, a task directory --
 * without the two stores being able to reach each other's locks.
 *
 * In-process only, which is the whole of it while one main process owns the
 * workspace. Two of them sharing a workspace directory would need a lock on
 * disk, a different and much larger thing.
 */
export function createWriteQueue() {
  // The tail of each key's chain, held only to be waited on. `unknown` is the
  // answer rather than a placeholder: successive jobs for one key resolve to
  // different types, nothing here reads any of them, and TypeScript has no way
  // to say "some type, and I don't care which". Narrowing it to `Promise<void>`
  // would mean allocating a second promise per call to discard a value nobody
  // was going to look at.
  const tails = new Map<string, Promise<unknown>>();

  return function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    // Both arms run the work: a failure ahead of this one is that caller's to
    // report, and dropping every write queued behind it would be worse.
    const queued = (tails.get(key) ?? Promise.resolve()).then(work, work);

    tails.set(key, queued);

    // Only the current tail clears the entry, so a queue something is already
    // waiting behind is never dropped out from under it.
    return queued.finally(() => {
      if (tails.get(key) === queued) {
        tails.delete(key);
      }
    });
  };
}
