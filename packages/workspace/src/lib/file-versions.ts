import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** The largest file a version is copied for; a bigger one is recorded without a copy. */
const MOST_COPIED_BYTES = 10 * 1024 * 1024;

/** The most a folder of versions keeps, its oldest copies going first past it. */
const MOST_KEPT_BYTES = 200 * 1024 * 1024;

/** One file's contents at a moment: their hash, size, and the copy kept of them. */
export interface KeptVersion {
  copy?: string;
  hash: string;
  size: number;
}

/**
 * Keeps a version of `file` in `folder`, under a folder named for the file and
 * a name made of the moment and `label`: `<folder>/moon.svg/2026-11-15 12.01
 * make it bigger.svg`. Contents already kept reuse that copy, so a file no
 * turn changed, or one put back as it was, costs nothing. The copy is a
 * clone where the disk makes one (APFS), so it takes no room until one side
 * changes. A kept copy is reused only while it still holds those contents.
 * Undefined for anything that is not a file.
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
  kept = [],
  label,
  now = new Date(),
  read,
}: {
  file: string;
  folder: string;
  /** The versions already kept of this file, any of which a copy may reuse. */
  kept?: readonly KeptVersion[];
  label: string;
  now?: Date;
  /** Reads the file through the agent's rules, refusing what they refuse. */
  read?: () => Promise<Uint8Array>;
}): Promise<KeptVersion | undefined> {
  const stats = await fs.stat(file).catch(() => undefined);
  if (!stats?.isFile()) {
    return undefined;
  }
  const { size } = stats;
  if (size > MOST_COPIED_BYTES) {
    return { hash: statHash(stats), size };
  }
  const bytes = read && (await read().catch(() => undefined));
  if (read && bytes === undefined) {
    return undefined;
  }
  const hash = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : await hashOf(file);
  for (const version of kept.toReversed()) {
    if (
      version.hash === hash &&
      version.copy !== undefined &&
      // A copy edited since it was kept no longer holds these contents.
      (await hashOf(version.copy).catch(() => undefined)) === hash
    ) {
      return { copy: version.copy, hash, size };
    }
  }
  const into = path.join(folder, path.basename(file));
  await fs.mkdir(into, { recursive: true });
  const copy = await copyUnder(
    bytes ?? file,
    into,
    `${stampOf(now)} ${label}`.trim(),
    path.extname(file),
  );
  return { copy, hash, size };
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
 * Removes the oldest copies in `folder` until what it keeps fits `most`
 * bytes, and any folder that leaves empty.
 */
export async function trimVersions(
  folder: string,
  most = MOST_KEPT_BYTES,
): Promise<void> {
  const entries = await fs
    .readdir(folder, { recursive: true, withFileTypes: true })
    .catch(() => []);
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

/** `2026-11-15 12.01`, in local time, sorting as it reads. */
function stampOf(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}`;
}

/**
 * Copies `source`, a file or its bytes, to `<folder>/<name><ext>`, or
 * `<name> 2<ext>` and on when that is taken, claiming the name with the copy
 * itself so two keepers at once never land on one.
 */
async function copyUnder(
  source: string | Uint8Array,
  folder: string,
  name: string,
  ext: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const at = path.join(
      folder,
      `${n === 1 ? name : `${name} ${String(n)}`}${ext}`,
    );
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
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    }
  }
}
