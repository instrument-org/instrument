import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** The largest file a version is copied for; a bigger one is recorded without a copy. */
export const MOST_COPIED_BYTES = 10 * 1024 * 1024;

/** The most a folder of versions keeps, its oldest copies going first past it. */
export const MOST_KEPT_BYTES = 200 * 1024 * 1024;

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
 * changes. Undefined for anything that is not a file.
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
}: {
  file: string;
  folder: string;
  /** The versions already kept of this file, any of which a copy may reuse. */
  kept?: readonly KeptVersion[];
  label: string;
  now?: Date;
}): Promise<KeptVersion | undefined> {
  const stats = await fs.stat(file).catch(() => undefined);
  if (!stats?.isFile()) {
    return undefined;
  }
  if (stats.size > MOST_COPIED_BYTES) {
    // Too big to hash on every turn: its size and time stand for its
    // contents, which is enough to tell that it changed.
    return { hash: `stat:${stats.size}:${stats.mtimeMs}`, size: stats.size };
  }
  const hash = await hashOf(file);
  for (const version of kept.toReversed()) {
    if (
      version.hash === hash &&
      version.copy !== undefined &&
      (await fs.stat(version.copy).catch(() => undefined))
    ) {
      return { copy: version.copy, hash, size: stats.size };
    }
  }
  const into = path.join(folder, path.basename(file));
  await fs.mkdir(into, { recursive: true });
  const copy = await freeName(
    into,
    `${stampOf(now)} ${label}`.trim(),
    path.extname(file),
  );
  await fs.copyFile(file, copy, fs.constants.COPYFILE_FICLONE);
  return { copy, hash, size: stats.size };
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

/** `<folder>/<name><ext>`, or `<name> 2<ext>` and on when that is taken. */
async function freeName(
  folder: string,
  name: string,
  ext: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const at = path.join(
      folder,
      `${n === 1 ? name : `${name} ${String(n)}`}${ext}`,
    );
    if (!(await fs.stat(at).catch(() => undefined))) {
      return at;
    }
  }
}
