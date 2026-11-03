import { MACOS_GUARDED_HOME_FOLDERS } from "@/shared/macos-guarded-folders";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * How many bytes of files a folder has, what the system's file manager reports
 * as its size, walked for a person looking at the folder's info.
 *
 * A folder this walk stepped over or could not read leaves it incomplete: the
 * count is then a floor, and the person is told so.
 */
export type FolderSize = { bytes: number; complete: boolean };

/**
 * Files sized at once. Well under the thread pool, since a dead network mount
 * holds a thread for each stat on it and aborting frees none of them.
 */
const STAT_BATCH = 8;

/** How long one step may take before the walk stops and says what it has. */
const STALL_MS = 10_000;

/** The Mac's data volume, which shows its folders a second time under this path. */
const MAC_DATA_VOLUME = "/System/Volumes/Data";

/**
 * The folders a walk that starts above them steps over on macOS, where it
 * would put up the system's prompt over a size nobody asked macOS about, under
 * either of the paths they have. A walk that starts at one of them was asked
 * for by name, and goes in. The data volume is stepped over from above too,
 * which would otherwise count all of it twice.
 */
export function folderSizeSkips({
  home = os.homedir(),
  platform = process.platform,
}: { home?: string; platform?: NodeJS.Platform } = {}): ReadonlySet<string> {
  if (platform !== "darwin") {
    return new Set();
  }
  return new Set([
    MAC_DATA_VOLUME,
    ...MACOS_GUARDED_HOME_FOLDERS.flatMap((name) => [
      path.join(home, name),
      path.join(MAC_DATA_VOLUME, home, name),
    ]),
  ]);
}

const STALLED = Symbol("stalled");

/** `work`, or `STALLED` once it has taken longer than a step should. */
async function withinStall<T>(work: Promise<T>, stallMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => {
      resolve(STALLED);
    }, stallMs);
  });
  try {
    return await Promise.race([work, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The size of the folder at `root`, or null where the folder itself cannot be
 * read. Walks from where `root` really is, so the folders it steps over are
 * recognized however it was reached, stays on that folder's own disk and never
 * follows a link inside it, so a disk or a link pointing back up is not counted
 * as part of it. A step that stalls, as on a dead network mount, ends the walk
 * with what it has. Throws when `signal` aborts, which is how a walk nobody is
 * waiting for ends.
 */
export async function folderSize(
  root: string,
  {
    signal,
    skips,
    stallMs = STALL_MS,
  }: {
    signal?: AbortSignal | undefined;
    skips?: ReadonlySet<string>;
    stallMs?: number;
  } = {},
): Promise<FolderSize | null> {
  const start = await withinStall(
    (async () => {
      const real = await fs.realpath(root);
      const stats = await fs.stat(real);
      return stats.isDirectory() ? { device: stats.dev, real } : null;
    })().catch(() => null),
    stallMs,
  );
  if (start === STALLED || start === null) {
    return null;
  }
  const { device, real } = start;
  const stepsOver =
    skips ??
    folderSizeSkips({
      home: await withinStall(
        fs.realpath(os.homedir()).catch(() => os.homedir()),
        stallMs,
      ).then((home) => (home === STALLED ? os.homedir() : home)),
    });
  let bytes = 0;
  let complete = true;
  const pending = [real];
  for (let folder = pending.pop(); folder; folder = pending.pop()) {
    signal?.throwIfAborted();
    const entries = await withinStall(
      fs.readdir(folder, { withFileTypes: true }).catch(() => null),
      stallMs,
    );
    if (entries === STALLED) {
      return folder === real ? null : { bytes, complete: false };
    }
    if (!entries) {
      if (folder === real) {
        return null;
      }
      complete = false;
      continue;
    }
    for (let at = 0; at < entries.length; at += STAT_BATCH) {
      signal?.throwIfAborted();
      const batch = await withinStall(
        Promise.all(
          entries.slice(at, at + STAT_BATCH).map(async (entry) => {
            const entryPath = path.join(folder, entry.name);
            if (entry.isDirectory() && stepsOver.has(entryPath)) {
              complete = false;
              return;
            }
            const stats = await fs.lstat(entryPath).catch(() => null);
            if (!stats) {
              complete = false;
            } else if (!stats.isDirectory()) {
              bytes += stats.size;
            } else if (stats.dev === device) {
              pending.push(entryPath);
            } else {
              complete = false;
            }
          }),
        ),
        stallMs,
      );
      if (batch === STALLED) {
        return { bytes, complete: false };
      }
    }
  }
  return { bytes, complete };
}
