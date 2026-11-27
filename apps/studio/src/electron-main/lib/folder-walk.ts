import {
  folderSizeSkips,
  STALL_MS,
  STALLED,
  withinStall,
} from "@/electron-main/lib/folder-size";
import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** One thing a walk found under the folder it started at. */
type WalkedEntry = {
  createdAt: number;
  /** The folder it is in, as a path from the folder walked, `/` between the names; "" for that folder itself. */
  folder: string;
  isFolder: boolean;
  modifiedAt: number;
  name: string;
  /** A Mac package, listed as a file and never entered. */
  package?: true;
  path: string;
  /** Left out for a folder or a package. */
  size?: number;
};

/**
 * What is under a folder, nearest first. `truncated` says the walk stopped
 * before the end, at the cap or at a folder that stopped answering, which
 * `stalledAt` names; `notSearched` names the folders it listed and stepped
 * over.
 */
type FolderWalk = {
  entries: WalkedEntry[];
  notSearched: string[];
  stalledAt?: string;
  truncated: boolean;
};

/** The most entries one walk gives. A folder of documents is far under it. */
const MAX_WALKED_ENTRIES = 30_000;

/**
 * Folders read at once. Under the thread pool's four, since a dead network
 * mount holds a thread for each read on it and aborting frees none of them.
 */
const READS_AT_ONCE = 3;

/** Entries stat'd at once within one folder. */
const STAT_BATCH = 8;

/** Folders left out along with everything in them, by name: what a program installed for itself. */
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(["node_modules"]);

/**
 * The folders a walk that starts above them steps over: the ones macOS
 * guards (`folderSizeSkips`), and on Windows the home folder's `AppData`,
 * where programs keep their own files, nearly all of a home folder's
 * entries and none of the person's.
 */
export function folderWalkSkips({
  home = os.homedir(),
  platform = process.platform,
}: { home?: string; platform?: NodeJS.Platform } = {}): ReadonlySet<string> {
  const skips = folderSizeSkips({ home, platform });
  return platform === "win32"
    ? new Set([...skips, path.win32.join(home, "AppData")])
    : skips;
}

/**
 * Folders a Mac shows as one file, by extension. Each is listed as a file
 * and never entered: what is inside is the program's own.
 */
const PACKAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".app",
  ".appex",
  ".bundle",
  ".framework",
  ".imovielibrary",
  ".key",
  ".kext",
  ".logicx",
  ".musiclibrary",
  ".numbers",
  ".pages",
  ".photoslibrary",
  ".plugin",
  ".rtfd",
  ".tvlibrary",
  ".xcodeproj",
  ".xcworkspace",
]);

/**
 * Everything under the folder at `root`, a level at a time so a cap keeps
 * the entries nearest the top, or null where the folder itself cannot be
 * read. Reads names and stats alone, so a file a cloud service keeps by name
 * is never downloaded.
 *
 * As `folderSize` walks: from where `root` really is, on that folder's own
 * disk, never following a link (a link is left out), stepping over the
 * folders `skips` names (by default `folderWalkSkips`),
 * and ending with what it has when a step stalls. Left out besides: names
 * starting with a dot and `node_modules`. A Mac package is listed and not
 * entered. Throws when `signal` aborts.
 */
export async function walkFolder(
  root: string,
  {
    maxEntries = MAX_WALKED_ENTRIES,
    signal,
    skips,
    stallMs = STALL_MS,
  }: {
    maxEntries?: number;
    signal?: AbortSignal | undefined;
    skips?: ReadonlySet<string>;
    stallMs?: number;
  } = {},
): Promise<FolderWalk | null> {
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
    folderWalkSkips({
      home: await withinStall(
        fs.realpath(os.homedir()).catch(() => os.homedir()),
        stallMs,
      ).then((home) => (home === STALLED ? os.homedir() : home)),
    });
  const walk: FolderWalk = { entries: [], notSearched: [], truncated: false };

  /** One folder's entries, or null when it cannot be read, or STALLED. */
  const read = (folder: string) =>
    withinStall(
      fs.readdir(folder, { withFileTypes: true }).catch(() => null),
      stallMs,
    );

  /** The entries of one folder the walk lists, stat'd, in name order, and the folders to go into. */
  const list = async (
    folder: { at: string; relative: string },
    entries: Dirent[],
  ) => {
    const listed = entries
      .filter(
        (entry) =>
          !entry.name.startsWith(".") &&
          (entry.isFile() ||
            (entry.isDirectory() && !SKIPPED_FOLDER_NAMES.has(entry.name))),
      )
      .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const found: {
      enter?: string;
      entry: WalkedEntry;
      steppedOver?: true;
    }[] = [];
    for (let at = 0; at < listed.length; at += STAT_BATCH) {
      signal?.throwIfAborted();
      const batch = await withinStall(
        Promise.all(
          listed.slice(at, at + STAT_BATCH).map(async (dirent) => {
            const entryPath = path.join(folder.at, dirent.name);
            const stats = await fs.lstat(entryPath).catch(() => null);
            if (!stats || !(stats.isFile() || stats.isDirectory())) {
              return null;
            }
            const isPackage =
              stats.isDirectory() &&
              PACKAGE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase());
            const isFolder = stats.isDirectory() && !isPackage;
            const entry: WalkedEntry = {
              createdAt: stats.birthtimeMs,
              folder: folder.relative,
              isFolder,
              modifiedAt: stats.mtimeMs,
              name: dirent.name,
              ...(isPackage ? { package: true as const } : {}),
              path: path.join(root, folder.relative, dirent.name),
              ...(stats.isFile() ? { size: stats.size } : {}),
            };
            if (!isFolder || stats.dev !== device) {
              return { entry };
            }
            if (stepsOver.has(entryPath)) {
              return { entry, steppedOver: true as const };
            }
            return { enter: entryPath, entry };
          }),
        ),
        stallMs,
      );
      if (batch === STALLED) {
        return STALLED;
      }
      for (const each of batch) {
        if (each) found.push(each);
      }
    }
    return found;
  };

  const pending = [{ at: real, relative: "" }];
  while (pending.length > 0) {
    signal?.throwIfAborted();
    const batch = pending.splice(0, READS_AT_ONCE);
    const reads = await Promise.all(
      batch.map(async (folder) => {
        const entries = await read(folder.at);
        return entries === STALLED || entries === null
          ? entries
          : list(folder, entries);
      }),
    );
    for (const [at, found] of reads.entries()) {
      const folder = batch[at];
      if (found === STALLED) {
        walk.truncated = true;
        walk.stalledAt = folder?.at ?? real;
        return walk;
      }
      if (found === null) {
        if (folder?.at === real) {
          return null;
        }
        continue;
      }
      for (const { enter, entry, steppedOver } of found) {
        if (walk.entries.length === maxEntries) {
          walk.truncated = true;
          return walk;
        }
        walk.entries.push(entry);
        if (steppedOver) {
          walk.notSearched.push(entry.path);
        }
        if (enter !== undefined) {
          pending.push({
            at: enter,
            relative:
              entry.folder === ""
                ? entry.name
                : `${entry.folder}/${entry.name}`,
          });
        }
      }
    }
  }
  return walk;
}
