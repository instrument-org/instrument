import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";

/**
 * What a folder of the person's holds, as one string that changes when what
 * is in a file changes and not otherwise: an editor that saves a file
 * unchanged, a `touch`, or a sync that rewrites the same bytes moves a file's
 * time and leaves its fingerprint where it was. So whoever acts on a change
 * (a list on screen, an agent told its skills changed) hears only of a real
 * one.
 *
 * A file's contents are read once per size and time it is seen with, and
 * kept by that: a folder read again where nothing moved costs only the
 * `lstat` of each file. A file past {@link LARGEST_READ} goes by its size and
 * time alone, which is all a build output or a data file needs.
 */
export async function folderFingerprint(
  dir: string,
  options: { depth?: number } = {},
): Promise<string> {
  return fingerprintOf(await filesUnder(dir, options));
}

/** One file under a folder, relative to it with `/`. */
export interface FileStamp {
  /** What its contents were when last read, or its size and time where it is not read. */
  content: string;
  path: string;
}

/** Files read under a folder before the rest go uncounted. */
const FILES_PER_FOLDER = 2000;

/** The largest file whose contents count, rather than its size and time. */
const LARGEST_READ = 1024 * 1024;

/** Folders inside the person's that are never their own content. */
const SKIPPED = new Set([...SKILL_ARTIFACT_IGNORE, ".git"]);

/**
 * Every file under `dir`, skipping what an install or a build leaves, each
 * with its contents' hash. Past {@link FILES_PER_FOLDER} it stops reading,
 * keeping what was reached: every file of a folder comes before any folder
 * below it, so a capped folder still counts its top level, where a skill's
 * `SKILL.md` or a topic's `TOPIC.md` is. `depth` stops it that many folders
 * down (0 for the folder's own files).
 */
export async function filesUnder(
  dir: string,
  { depth = Number.POSITIVE_INFINITY }: { depth?: number } = {},
): Promise<FileStamp[]> {
  const files: FileStamp[] = [];
  const queue: { level: number; relative: string }[] = [
    { level: 0, relative: "" },
  ];
  while (queue.length > 0 && files.length < FILES_PER_FOLDER) {
    const { level, relative } = queue.shift() ?? { level: 0, relative: "" };
    const entries = await entriesOf(path.join(dir, relative));
    const room = FILES_PER_FOLDER - files.length;
    const ownFiles = entries.filter((entry) => !entry.isDirectory());
    const stamped = await Promise.all(
      ownFiles.slice(0, room).map(async (entry) => {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        const content = await contentOf(path.join(dir, child));
        return content === undefined ? undefined : { content, path: child };
      }),
    );
    for (const file of stamped) {
      if (file) {
        files.push(file);
      }
    }
    if (level >= depth) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIPPED.has(entry.name)) {
        queue.push({
          level: level + 1,
          relative: relative ? `${relative}/${entry.name}` : entry.name,
        });
      }
    }
  }
  return files;
}

/** One hash over the files given, whatever order they came in. */
export function fingerprintOf(files: readonly FileStamp[]): string {
  const hash = createHash("sha1");
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${file.content}\n`);
  }
  return hash.digest("hex");
}

/**
 * Each file's hash, kept by the size and time it was read at. Cleared whole
 * past {@link CACHE_LIMIT}, since what a session reads again is the same
 * few folders and reading them once more is cheap.
 */
const CONTENT_CACHE = new Map<
  string,
  { hash: string; mtimeMs: number; size: number }
>();
const CACHE_LIMIT = 20_000;

async function contentOf(file: string): Promise<string | undefined> {
  const stats = await fs.lstat(file).catch(() => undefined);
  if (!stats) {
    return undefined;
  }
  if (!stats.isFile() || stats.size > LARGEST_READ) {
    return `${stats.size}:${stats.mtimeMs}`;
  }
  const cached = CONTENT_CACHE.get(file);
  if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.hash;
  }
  const bytes = await fs.readFile(file).catch(() => undefined);
  if (!bytes) {
    return undefined;
  }
  const hash = createHash("sha1").update(bytes).digest("hex");
  if (CONTENT_CACHE.size >= CACHE_LIMIT) {
    CONTENT_CACHE.clear();
  }
  CONTENT_CACHE.set(file, { hash, mtimeMs: stats.mtimeMs, size: stats.size });
  return hash;
}

async function entriesOf(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // A folder not made yet, or gone since it was listed.
    return [];
  }
}
