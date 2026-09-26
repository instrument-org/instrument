/**
 * The live editors open on each file, by path, each by the one thing another
 * view of the same file needs from it: getting what was typed onto disk.
 *
 * A file can be shown two ways in one place (a Markdown document and its
 * source, say), and the view taking over reads the file when it mounts. So the
 * view giving way writes first, and the swap waits for it.
 */
const flushers = new Map<string, Set<() => Promise<unknown>>>();

/** Writes whatever the file's open editors hold unsaved, and settles once it is on disk. */
export async function flushFileWrites(hostPath: string) {
  await Promise.allSettled(
    [...(flushers.get(hostPath) ?? [])].map((flush) => flush()),
  );
}

/** Makes an editor's pending writes reachable by path; returns the way to withdraw it. */
export function registerFileFlush(
  hostPath: string,
  flush: () => Promise<unknown>,
) {
  let set = flushers.get(hostPath);
  if (!set) {
    set = new Set();
    flushers.set(hostPath, set);
  }
  set.add(flush);
  return () => {
    set.delete(flush);
    if (set.size === 0) {
      flushers.delete(hostPath);
    }
  };
}
