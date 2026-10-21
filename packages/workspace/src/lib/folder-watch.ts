import ms from "ms";
import { type FSWatcher, readdirSync, watch } from "node:fs";
import path from "node:path";

import { afterFolderAppears, isFolder } from "./folder-appears";
import { folderFingerprint } from "./folder-fingerprint";
import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";

/** Long enough that a save and the editor's rename around it are one change. */
const SETTLE_MS = ms("150 milliseconds");

/**
 * How often the folder is read again whatever the watchers said: what they
 * missed (a change deeper than they watch, an event the system dropped, a
 * network or synced folder that reports nothing) is found this late at most.
 */
const RECHECK_MS = ms("5 seconds");

/** A folder's state when it is not there, which no fingerprint equals. */
const GONE = "gone";

/** Folders inside the person's that change without anyone editing them. */
const UNWATCHED = new Set([...SKILL_ARTIFACT_IGNORE, ".git"]);

interface Watched {
  listeners: Set<() => void>;
  stop: () => void;
}

/** One watch per folder and depth, however many are listening. */
const WATCHED = new Map<string, Watched>();

/**
 * Calls `onChange` when what a folder of the person's holds changes: a file
 * added, removed, or saved with different contents, by anyone. A save that
 * leaves a file as it was is no change (`folder-fingerprint.ts`).
 *
 * The folder and, to `depth`, the folders in it are watched, so an edit
 * there is heard within a beat; everything below is read again every
 * {@link RECHECK_MS}, which also catches what a watcher missed. A watcher
 * that fails is set up again rather than given up on, and a folder that is
 * removed is waited for again, so neither ends the watch. A folder not made
 * yet (a workspace that never saved a memory has no `Memory/`) is waited for
 * the same way, and its turning up is a change.
 *
 * Returns the stop. Several callers watching one folder share one watch.
 */
export function watchFolder(
  dir: string,
  {
    depth = 1,
    onChange,
    recheckMs = RECHECK_MS,
  }: {
    depth?: number;
    onChange: () => void;
    /** How often it is read regardless; the default suits every folder of the person's. */
    recheckMs?: number;
  },
): () => void {
  const key = `${path.resolve(dir)}\0${depth}\0${recheckMs}`;
  let watched = WATCHED.get(key);
  if (!watched) {
    const listeners = new Set<() => void>();
    const stop = startWatching(dir, { depth, recheckMs }, () => {
      for (const listener of listeners) {
        listener();
      }
    });
    watched = { listeners, stop };
    WATCHED.set(key, watched);
  }
  const { listeners } = watched;
  const listener = () => {
    onChange();
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && WATCHED.get(key) === watched) {
      WATCHED.delete(key);
      watched.stop();
    }
  };
}

/** Stops every watch, for a process shutting down. */
export function stopWatchingFolders(): void {
  for (const watched of WATCHED.values()) {
    watched.stop();
  }
  WATCHED.clear();
}

function startWatching(
  dir: string,
  { depth, recheckMs }: { depth: number; recheckMs: number },
  changed: () => void,
): () => void {
  let stopped = false;
  let watchers: FSWatcher[] = [];
  let stopWaiting: (() => void) | undefined;
  let settle: NodeJS.Timeout | undefined;
  // What the folder held when last read; undefined until the first read.
  let last: string | undefined;
  let reading: Promise<void> | undefined;
  let readAgain = false;

  const unwatch = () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    watchers = [];
  };

  const soon = () => {
    if (stopped) {
      return;
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      void read();
    }, SETTLE_MS);
  };

  /** Watches the folder and the folders in it, to `depth`, afresh. */
  const arm = () => {
    unwatch();
    const folders = [dir, ...foldersIn(dir, depth)];
    for (const folder of folders) {
      try {
        const watcher = watch(folder, soon);
        // A watcher that fails (its folder removed, a handle the system took
        // back) is read past and set up again, never left dead.
        watcher.on("error", soon);
        watchers.push(watcher);
      } catch {
        // Gone between the listing and the watch: the read after this
        // finds out which.
        soon();
      }
    }
  };

  const read = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return reading;
    }
    reading = (async () => {
      do {
        readAgain = false;
        if (stopped) {
          return;
        }
        const now = isFolder(dir) ? await folderFingerprint(dir) : GONE;
        if (stopped) {
          return;
        }
        const first = last === undefined;
        if (now === last) {
          continue;
        }
        last = now;
        if (now === GONE) {
          unwatch();
          stopWaiting?.();
          stopWaiting = afterFolderAppears(dir, soon);
        } else {
          stopWaiting?.();
          stopWaiting = undefined;
          // What it holds changed, and with it maybe the folders to watch.
          arm();
        }
        if (!first) {
          changed();
        }
      } while (readAgain);
    })().finally(() => {
      reading = undefined;
    });
    return reading;
  };

  const recheck = setInterval(() => {
    void read();
  }, recheckMs);
  recheck.unref();
  void read();

  return () => {
    stopped = true;
    clearInterval(recheck);
    clearTimeout(settle);
    stopWaiting?.();
    unwatch();
  };
}

/** The folders under `dir` a watcher is set on, to `depth`. */
function foldersIn(dir: string, depth: number): string[] {
  if (depth <= 0) {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !UNWATCHED.has(entry.name))
    .flatMap((entry) => {
      const folder = path.join(dir, entry.name);
      return [folder, ...foldersIn(folder, depth - 1)];
    });
}
