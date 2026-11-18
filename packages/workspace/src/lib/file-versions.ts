import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** The largest file a version is copied for; a bigger one is recorded without a copy. */
export const MOST_COPIED_BYTES = 10 * 1024 * 1024;

/** The most a chat's versions keep, its oldest copies going first past it. */
const MOST_KEPT_BYTES = 200 * 1024 * 1024;

/** One file's contents at a moment: their hash, size, number, and the copy kept of them. */
export interface KeptVersion {
  copy?: string;
  hash: string;
  /** Which version of the file it is in the chat, from 1, the oldest. */
  number: number;
  size: number;
}

/**
 * Extensions macOS takes a folder for a document by (a package), so a folder
 * of versions named with one would show in the Finder as a broken document.
 */
const PACKAGE_EXTENSIONS = new Set([
  "action",
  "app",
  "appex",
  "band",
  "bundle",
  "component",
  "doccarchive",
  "dsym",
  "fcpbundle",
  "framework",
  "imovielibrary",
  "kext",
  "key",
  "logicx",
  "mdimporter",
  "mpkg",
  "musiclibrary",
  "numbers",
  "pages",
  "photoslibrary",
  "pkg",
  "playground",
  "plugin",
  "prefpane",
  "qlgenerator",
  "rtfd",
  "saver",
  "scptd",
  "sparsebundle",
  "theater",
  "tvlibrary",
  "utm",
  "wdgt",
  "workflow",
  "xcodeproj",
  "xcworkspace",
  "xpc",
]);

/**
 * Keeps a version of `file` in `folder`, numbered in a folder of the file's
 * own: `<folder>/moon.svg/v3.svg`. Contents the newest version already has
 * are that version, under its number and reusing its copy, so a file no turn
 * changed costs nothing; any other contents are the next number, contents an
 * older version had included, and so is every version kept `fresh` (a
 * restore). The copy is a clone where the disk makes one (APFS), so it takes
 * no room until one side changes. Numbers only go up, and one whose file is
 * already there (its copy edited since, or a keeper at once) is passed
 * over. Undefined for anything that is not a file.
 *
 * The file's folder is the one its versions are already kept in, or else
 * the first of `<name>`, `<name> 2` and on that no other file's versions
 * are in. A package's name (`deck.key`) loses its extension there.
 *
 * With `read`, the copy is made from the bytes it returns, so a file the
 * rules holding the agent refuse it, or a symlink leading out of what they
 * let it read, keeps nothing; the copy is then a plain one.
 *
 * Knows nothing of who wrote the file or why: a chat's turn and an editor's
 * save are both callers.
 */
export async function keepVersion({
  file,
  folder,
  fresh = false,
  kept = [],
  read,
  taken = new Set(),
}: {
  file: string;
  folder: string;
  /** Whether it is a number of its own even for the contents the newest version has. */
  fresh?: boolean;
  /**
   * The versions already kept of this file, oldest first, each with its copy
   * where that is on this computer.
   */
  kept?: readonly KeptVersion[];
  /** Reads the file through the agent's rules, refusing what they refuse. */
  read?: () => Promise<Uint8Array>;
  /** The folders in `folder` other files' versions are kept in, by name. */
  taken?: ReadonlySet<string>;
}): Promise<KeptVersion | undefined> {
  const stats = await fs.stat(file).catch(() => undefined);
  if (!stats?.isFile()) {
    return undefined;
  }
  const { size } = stats;
  const newest = kept.at(-1);
  const most = Math.max(0, ...kept.map((version) => version.number));
  if (size > MOST_COPIED_BYTES) {
    const hash = statHash(stats);
    return {
      hash,
      number: !fresh && newest?.hash === hash ? newest.number : most + 1,
      size,
    };
  }
  const bytes = read && (await read().catch(() => undefined));
  if (read && bytes === undefined) {
    return undefined;
  }
  const hash = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : await hashOf(file);
  const same = !fresh && newest?.hash === hash ? newest.number : undefined;
  if (same !== undefined) {
    for (const version of kept.toReversed()) {
      if (
        version.number === same &&
        version.copy !== undefined &&
        // A copy edited since it was kept no longer holds these contents.
        (await hashOf(version.copy).catch(() => undefined)) === hash
      ) {
        return { copy: version.copy, hash, number: same, size };
      }
    }
  }
  const into = await folderFor({ file, folder, kept, taken });
  const ext = path.extname(file);
  // The newest version's number, for a copy of it this computer lacks.
  if (same !== undefined) {
    const copy = await copyAs(bytes ?? file, into, same, ext);
    if (copy !== undefined) {
      return { copy, hash, number: same, size };
    }
  }
  for (let number = most + 1; ; number++) {
    const copy = await copyAs(bytes ?? file, into, number, ext);
    if (copy !== undefined) {
      return { copy, hash, number, size };
    }
  }
}

/** The name of the folder a file's versions are kept in: its own, less a package's extension. */
function versionsFolderName(name: string): string {
  const ext = path.extname(name);
  return PACKAGE_EXTENSIONS.has(ext.slice(1).toLowerCase())
    ? name.slice(0, -ext.length)
    : name;
}

/**
 * What `file` holds, as the hash its versions are recorded by. A file too big
 * to copy is hashed by its size and time instead, which is enough to tell
 * that it changed. Undefined for anything that is not a file.
 */
export async function contentsOf(
  file: string,
): Promise<{ hash: string; isTooBig: boolean; size: number } | undefined> {
  const stats = await fs.stat(file).catch(() => undefined);
  if (!stats?.isFile()) {
    return undefined;
  }
  if (stats.size > MOST_COPIED_BYTES) {
    return { hash: statHash(stats), isTooBig: true, size: stats.size };
  }
  return { hash: await hashOf(file), isTooBig: false, size: stats.size };
}

/**
 * Removes the oldest copies in `folders` until what they keep together fits
 * `most` bytes, and any folder that leaves empty.
 */
export async function trimVersions(
  folders: readonly string[],
  most = MOST_KEPT_BYTES,
): Promise<void> {
  const entries = (
    await Promise.all(
      folders.map((folder) =>
        fs
          .readdir(folder, { recursive: true, withFileTypes: true })
          .catch(() => []),
      ),
    )
  ).flat();
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const at = path.join(entry.parentPath, entry.name);
        const stats = await fs.stat(at);
        return { at, mtimeMs: stats.mtimeMs, size: stats.size };
      }),
  );
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= most) {
      break;
    }
    await fs.rm(file.at, { force: true });
    await fs.rmdir(path.dirname(file.at)).catch(() => undefined);
    total -= file.size;
  }
}

/**
 * The folder in `folder` a file's versions go in: the one they are already
 * kept in here, or a new one named for the file that no other file's
 * versions are in, claimed by making it, so two keepers at once never share
 * one.
 */
async function folderFor({
  file,
  folder,
  kept,
  taken,
}: {
  file: string;
  folder: string;
  kept: readonly KeptVersion[];
  taken: ReadonlySet<string>;
}): Promise<string> {
  const own = kept
    .flatMap(({ copy }) =>
      copy !== undefined && path.dirname(path.dirname(copy)) === folder
        ? [path.dirname(copy)]
        : [],
    )
    .at(-1);
  if (own !== undefined) {
    await fs.mkdir(own, { recursive: true });
    return own;
  }
  await fs.mkdir(folder, { recursive: true });
  const name = versionsFolderName(path.basename(file));
  for (let n = 1; ; n++) {
    const each = n === 1 ? name : `${name} ${String(n)}`;
    if (taken.has(each)) {
      continue;
    }
    const at = path.join(folder, each);
    try {
      await fs.mkdir(at);
      return at;
    } catch (error) {
      if (!isTaken(error)) {
        throw error;
      }
    }
  }
}

/** What a file too big to copy is recorded by: enough to tell that it changed. */
function statHash(stats: { mtimeMs: number; size: number }): string {
  return `stat:${String(stats.size)}:${String(stats.mtimeMs)}`;
}

async function hashOf(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/**
 * Copies `source`, a file or its bytes, to `<folder>/v<number><ext>`,
 * claiming the name with the copy itself; undefined when it is taken.
 */
async function copyAs(
  source: string | Uint8Array,
  folder: string,
  number: number,
  ext: string,
): Promise<string | undefined> {
  const at = path.join(folder, `v${String(number)}${ext}`);
  try {
    await (typeof source === "string"
      ? fs.copyFile(
          source,
          at,
          fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL,
        )
      : fs.writeFile(at, source, { flag: "wx" }));
    return at;
  } catch (error) {
    if (isTaken(error)) {
      return undefined;
    }
    throw error;
  }
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
