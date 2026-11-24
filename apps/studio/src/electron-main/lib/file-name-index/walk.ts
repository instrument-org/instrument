import { foldFileName } from "@/shared/file-name-match";
import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * The names a walk found, as columns rather than a record per name, since a
 * walk keeps a few hundred thousand of them: entry `i` is `names[i]` in the
 * folder `folders[parents[i]]`, and `folded[i]` is its name as a search
 * compares it. `capped` says a cap, or a folder that stopped answering, cut
 * the walk short.
 */
export type FileNames = {
  capped: boolean;
  folded: string[];
  folders: string[];
  isFolder: boolean[];
  names: string[];
  parents: number[];
};

/**
 * The most names one root gives the index. A folder of documents is far
 * under it, and a home folder or a big repository reaches it with its
 * shallowest names kept, since a root is walked a level at a time. A name
 * takes about 125 bytes, so a root is at most 6 MB.
 */
const MAX_NAMES_PER_ROOT = 50_000;

/**
 * The most names the index keeps over all roots, however many folders are
 * pinned: about 25 MB in the main process, and a search, which reads every
 * name on the main thread, done in about 15 ms.
 */
const MAX_NAMES = 200_000;

/**
 * Folders read at once. Under the thread pool's four, since a dead network
 * mount holds a thread for each read on it and nothing frees one.
 */
const READS_AT_ONCE = 3;

/** How long one folder may take to answer before its root's walk ends with what it has. */
const STALL_MS = 10_000;

/** Folders left out along with everything in them, by name: what a program installed for itself. */
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(["node_modules"]);

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

const STALLED = Symbol("stalled");

/**
 * A folder's path as two spellings of it compare: absolute, and lowercased
 * where the system's disks ignore case by default (macOS and Windows).
 */
function folderKey(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = path.resolve(folder);
  return platform === "linux" ? resolved : resolved.toLowerCase();
}

/**
 * The names of the files and folders under `roots`, each root walked a
 * level at a time so a cap keeps the names nearest the top.
 *
 * Left out: names starting with a dot, `node_modules`, links (a link to a
 * folder is never followed, so no loop of links is walked twice, and
 * telling a link to a file from one to a folder would read where it leads),
 * and what is neither file nor folder. A Mac package is listed and not
 * entered. A folder `staysOut` names is listed where its parent is walked
 * and never read, as a root or below one. A root inside another root is
 * walked once, as its own root with its own cap. A folder that cannot be
 * read is passed over, and a root that is missing, a file or a link gives
 * nothing.
 *
 * Reads go through `fs.promises`, so the thread the caller is on only ever
 * handles one folder's entries between waits.
 */
export async function walkFileNames({
  maxNames = MAX_NAMES,
  maxNamesPerRoot = MAX_NAMES_PER_ROOT,
  readFolder = (folder) => fs.readdir(folder, { withFileTypes: true }),
  roots,
  stallMs = STALL_MS,
  staysOut = () => false,
}: {
  maxNames?: number;
  maxNamesPerRoot?: number;
  readFolder?: (folder: string) => Promise<Dirent[]>;
  roots: readonly string[];
  stallMs?: number;
  staysOut?: (folder: string) => boolean;
}): Promise<FileNames> {
  const found: FileNames = {
    capped: false,
    folded: [],
    folders: [],
    isFolder: [],
    names: [],
    parents: [],
  };
  const rootKeys = new Set(roots.map((root) => folderKey(root)));
  const walked = new Set<string>();
  for (const root of roots) {
    const key = folderKey(root);
    if (walked.has(key) || staysOut(root) || !(await isFolder(root, stallMs))) {
      continue;
    }
    walked.add(key);
    let room = Math.min(maxNamesPerRoot, maxNames - found.names.length);
    const pending = [path.resolve(root)];
    while (pending.length > 0 && room > 0) {
      const batch = pending.splice(0, READS_AT_ONCE);
      const lists = await Promise.all(
        batch.map((folder) =>
          withinStall(
            readFolder(folder).catch(() => null),
            stallMs,
          ),
        ),
      );
      for (const [at, list] of lists.entries()) {
        const folder = batch[at];
        if (list === STALLED) {
          found.capped = true;
          room = 0;
          break;
        }
        if (!list || folder === undefined) {
          continue;
        }
        let parent: number | undefined;
        for (const entry of list.toSorted(byName)) {
          const kind = kindOf(entry);
          if (kind === undefined) {
            continue;
          }
          if (room === 0) {
            found.capped = true;
            break;
          }
          parent ??= found.folders.push(folder) - 1;
          found.names.push(entry.name);
          found.folded.push(foldFileName(entry.name));
          found.parents.push(parent);
          found.isFolder.push(kind === "folder");
          room -= 1;
          const entryPath = path.join(folder, entry.name);
          if (
            kind === "folder" &&
            !rootKeys.has(folderKey(entryPath)) &&
            !staysOut(entryPath)
          ) {
            pending.push(entryPath);
          }
        }
      }
      if (room === 0 && pending.length > 0) {
        found.capped = true;
      }
    }
  }
  return found;
}

/** What an entry is listed as, or undefined for one that is left out. */
function kindOf(entry: Dirent): "file" | "folder" | undefined {
  if (entry.name.startsWith(".")) {
    return undefined;
  }
  if (entry.isFile()) {
    return "file";
  }
  if (!entry.isDirectory() || SKIPPED_FOLDER_NAMES.has(entry.name)) {
    return undefined;
  }
  return PACKAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ? "file"
    : "folder";
}

/** A folder's entries in one order on every system, so a cap keeps the same names each walk. */
function byName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Whether a folder is at `root` itself, a link there not counting as one. */
async function isFolder(root: string, stallMs: number): Promise<boolean> {
  const stats = await withinStall(
    fs.lstat(root).catch(() => null),
    stallMs,
  );
  return stats !== STALLED && stats !== null && stats.isDirectory();
}

/** `work`, or `STALLED` once it has taken longer than `stallMs`. */
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
