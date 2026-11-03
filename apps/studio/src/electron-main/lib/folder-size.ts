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

/** Files sized at once, a folder of thousands at a time being the common slow case. */
const STAT_BATCH = 32;

/**
 * The folders a walk that starts above them steps over on macOS, where it
 * would put up the system's prompt over a size nobody asked macOS about. A walk
 * that starts at one of them was asked for by name, and goes in.
 */
export function folderSizeSkips({
  home = os.homedir(),
  platform = process.platform,
}: { home?: string; platform?: NodeJS.Platform } = {}): ReadonlySet<string> {
  if (platform !== "darwin") {
    return new Set();
  }
  return new Set(
    MACOS_GUARDED_HOME_FOLDERS.map((name) => path.join(home, name)),
  );
}

/**
 * The size of the folder at `root`, or null where the folder itself cannot be
 * read. Stays on the folder's own disk and never follows a link inside it, so a disk or
 * a link pointing back up is not counted as part of it. Throws when `signal`
 * aborts, which is how a walk nobody is waiting for ends.
 */
export async function folderSize(
  root: string,
  {
    signal,
    skips = folderSizeSkips(),
  }: { signal?: AbortSignal | undefined; skips?: ReadonlySet<string> } = {},
): Promise<FolderSize | null> {
  // The root by where it leads, since a link to a folder lists as a folder.
  const device = await fs.stat(root).then(
    (stats) => (stats.isDirectory() ? stats.dev : null),
    () => null,
  );
  if (device === null) {
    return null;
  }
  let bytes = 0;
  let complete = true;
  const pending = [root];
  for (let folder = pending.pop(); folder; folder = pending.pop()) {
    signal?.throwIfAborted();
    const entries = await fs
      .readdir(folder, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      if (folder === root) {
        return null;
      }
      complete = false;
      continue;
    }
    for (let at = 0; at < entries.length; at += STAT_BATCH) {
      signal?.throwIfAborted();
      await Promise.all(
        entries.slice(at, at + STAT_BATCH).map(async (entry) => {
          const entryPath = path.join(folder, entry.name);
          if (entry.isDirectory() && skips.has(entryPath)) {
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
      );
    }
  }
  return { bytes, complete };
}
