import fsSync from "node:fs";
import fs from "node:fs/promises";

/**
 * How often the stat runs. A file the person is looking at changing "within a
 * second" is what this is for.
 */
const WATCH_INTERVAL_MS = 1000;

/** What a watched file is at a moment: when it was last written, or nothing while it is not there. */
export interface HostFileInfo {
  modifiedAt: number;
}

/**
 * The file at a path on this computer, and every subsequent version of it,
 * until the caller stops listening.
 *
 * A stat on an interval (`fs.watchFile`) rather than a filesystem watcher: the
 * one question is whether the file changed, and a stat answers exactly that
 * with no rename semantics, no duplicate events, and no trouble on a network
 * share. It works on a path that is not there yet and fires when it appears,
 * and a deletion arrives as a zeroed stat, so the missing state needs no
 * separate signal. Node shares one poller per filename across listeners, so
 * two watchers of one file cost one stat.
 */
export async function* watchHostFile({
  intervalMs = WATCH_INTERVAL_MS,
  path,
  signal,
}: {
  intervalMs?: number;
  path: string;
  signal?: AbortSignal;
}): AsyncGenerator<HostFileInfo | null> {
  const read = async () => {
    try {
      const stats = await fs.stat(path);
      return stats.isFile() ? { modifiedAt: stats.mtimeMs } : null;
    } catch {
      return null;
    }
  };

  // Handed out before each read and resolved by the next change, so a write
  // that lands while the consumer still holds the previous value resolves the
  // promise this loop is about to await rather than one nobody is waiting on.
  let announce: () => void;
  let changed = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const notify = () => {
    const previous = announce;
    changed = new Promise<void>((resolve) => {
      announce = resolve;
    });
    previous();
  };
  const listener = () => {
    notify();
  };

  signal?.addEventListener("abort", notify, { once: true });
  fsSync.watchFile(path, { interval: intervalMs }, listener);
  try {
    while (signal?.aborted !== true) {
      const next = changed;
      yield await read();
      await next;
    }
  } finally {
    fsSync.unwatchFile(path, listener);
    signal?.removeEventListener("abort", notify);
  }
}
