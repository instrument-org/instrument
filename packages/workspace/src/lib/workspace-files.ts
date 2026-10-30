import fs from "node:fs";

import { openOwnFileToRead } from "./own-file";

/**
 * The way to read the contents of a file under the workspace root.
 *
 * The workspace may be in a folder a cloud service syncs (iCloud Drive,
 * Dropbox, OneDrive), which can keep any file there by name only, with its
 * contents downloaded when something reads it. On macOS a read of such a
 * file does not fail: a synchronous one blocks its thread until the
 * download ends, and the workspace runs on the main thread. So every read
 * here goes through `fs.promises`, which waits on the thread pool instead.
 *
 * A read waits for a file kept by name only. A caller whose next look picks
 * the file up, and so would rather pass over one, tells it first with
 * {@link keptByNameOnly}: metadata (`stat`, `readdir`) never downloads, so
 * it is cheap either way.
 */

/**
 * For a file in a folder the agent's programs can change, that folder, from
 * which down to the file no link is followed (`openOwnFile`).
 */
export type ReadOptions = { ownFolder?: string };

/**
 * Whether a file's contents are only in the cloud (macOS's dataless files,
 * iCloud Drive's evicted ones among them), told without reading it: it has
 * contents and no blocks on disk.
 */
export function keptByNameOnly(
  stats: fs.Stats,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "darwin" &&
    stats.isFile() &&
    stats.size > 0 &&
    stats.blocks === 0
  );
}

/** The whole file as text. */
export function readText(
  file: string,
  options: ReadOptions = {},
): Promise<string> {
  return withHandle(file, options, (handle) => handle.readFile("utf8"));
}

/** The whole file as bytes. */
export function readBytes(
  file: string,
  options: ReadOptions = {},
): Promise<Buffer> {
  return withHandle(file, options, (handle) => handle.readFile());
}

/** Up to the first `bytes` of the file, as text. */
export function readHead(
  file: string,
  bytes: number,
  options: ReadOptions = {},
): Promise<string> {
  return withHandle(file, options, async (handle) => {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  });
}

/** The whole lines of a file from a byte offset, and the offset they end at. */
export type LinesRead = { end: number; lines: string[] };

/**
 * The whole lines of `file` from byte `from`, and where they end. A last line
 * with no newline yet (a sync engine part way through bringing the file
 * over, or a write cut short) is left for the next read.
 */
export function readLinesFrom(
  file: string,
  from: number,
  options: ReadOptions = {},
): Promise<LinesRead> {
  return withHandle(file, options, async (handle) => {
    const { size } = await handle.stat();
    const bytes = Buffer.alloc(Math.max(0, size - from));
    await handle.read(bytes, 0, bytes.length, from);
    const whole = bytes.lastIndexOf(0x0a) + 1;
    return {
      end: from + whole,
      lines: bytes
        .subarray(0, whole)
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== ""),
    };
  });
}

/**
 * Files read as text and parsed, each kept until its size or modification
 * time changes, so a file read far more often than it changes is read once
 * per change and stat-ed the rest of the time. `parse` is handed the stats
 * the file was read under.
 */
export class CachedReads<T> {
  readonly #cache = new Map<
    string,
    { mtimeMs: number; size: number; value: T }
  >();
  readonly #parse: (text: string, file: string, stats: fs.Stats) => T;

  constructor(parse: (text: string, file: string, stats: fs.Stats) => T) {
    this.#parse = parse;
  }

  /**
   * Drops what was kept for a file, so the next read reads it whatever its
   * stats say: for a writer of the file, whose write can leave its size and
   * modification time as they were.
   */
  forget(file: string): void {
    this.#cache.delete(file);
  }

  /** Drops what was kept for every file but these: the ones a look found still there. */
  prune(files: Iterable<string>): void {
    const kept = new Set(files);
    for (const file of this.#cache.keys()) {
      if (!kept.has(file)) {
        this.#cache.delete(file);
      }
    }
  }

  async read(file: string, options: ReadOptions = {}): Promise<T> {
    const stats = await fs.promises.stat(file);
    const kept = this.#cache.get(file);
    if (kept?.size === stats.size && kept.mtimeMs === stats.mtimeMs) {
      return kept.value;
    }
    // Stat-ed before the read, so a change that lands during it is read
    // again next time.
    const value = this.#parse(await readText(file, options), file, stats);
    this.#cache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, value });
    return value;
  }
}

async function withHandle<T>(
  file: string,
  { ownFolder }: ReadOptions,
  read: (handle: fs.promises.FileHandle) => Promise<T>,
): Promise<T> {
  const handle =
    ownFolder === undefined
      ? await fs.promises.open(file, "r")
      : await openOwnFileToRead({ file, folder: ownFolder });
  try {
    return await read(handle);
  } finally {
    await handle.close();
  }
}
