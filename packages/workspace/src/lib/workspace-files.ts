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
 * A read waits for a file kept by name only by default. With
 * `{ evicted: "pass" }` it answers {@link NOT_HERE_YET} for one instead,
 * without downloading it, for a caller whose next look picks the file up.
 * Metadata (`stat`, `readdir`) never downloads, so it is cheap either way.
 */

/** What a read that passes over a file kept by name only answers for one. */
export const NOT_HERE_YET: unique symbol = Symbol("not here yet");
export type NotHereYet = typeof NOT_HERE_YET;

/**
 * Whether a read waits for a file kept by name only, or passes over it; and,
 * for a file in a folder the agent's programs can change, that folder, from
 * which down to the file no link is followed (`openOwnFile`).
 */
export type ReadOptions = { evicted?: "pass" | "wait"; ownFolder?: string };
type Waits = { evicted?: "wait"; ownFolder?: string };
type Passes = { evicted: "pass"; ownFolder?: string };

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
export function readText(file: string, options?: Waits): Promise<string>;
export function readText(
  file: string,
  options: Passes,
): Promise<NotHereYet | string>;
export function readText(
  file: string,
  options: ReadOptions = {},
): Promise<NotHereYet | string> {
  return withHandle(file, options, (handle) => handle.readFile("utf8"));
}

/** The whole file as bytes. */
export function readBytes(file: string, options?: Waits): Promise<Buffer>;
export function readBytes(
  file: string,
  options: Passes,
): Promise<Buffer | NotHereYet>;
export function readBytes(
  file: string,
  options: ReadOptions = {},
): Promise<Buffer | NotHereYet> {
  return withHandle(file, options, (handle) => handle.readFile());
}

/** Up to the first `bytes` of the file, as text. */
export function readHead(
  file: string,
  bytes: number,
  options?: Waits,
): Promise<string>;
export function readHead(
  file: string,
  bytes: number,
  options: Passes,
): Promise<NotHereYet | string>;
export function readHead(
  file: string,
  bytes: number,
  options: ReadOptions = {},
): Promise<NotHereYet | string> {
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
  options?: Waits,
): Promise<LinesRead>;
export function readLinesFrom(
  file: string,
  from: number,
  options: Passes,
): Promise<LinesRead | NotHereYet>;
export function readLinesFrom(
  file: string,
  from: number,
  options: ReadOptions = {},
): Promise<LinesRead | NotHereYet> {
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
 * per change and stat-ed the rest of the time.
 */
export class CachedReads<T> {
  readonly #cache = new Map<
    string,
    { mtimeMs: number; size: number; value: T }
  >();
  readonly #parse: (text: string, file: string) => T;

  constructor(parse: (text: string, file: string) => T) {
    this.#parse = parse;
  }

  read(file: string, options?: Waits): Promise<T>;
  read(file: string, options: Passes): Promise<NotHereYet | T>;
  async read(file: string, options: ReadOptions = {}): Promise<NotHereYet | T> {
    const stats = await fs.promises.stat(file);
    const kept = this.#cache.get(file);
    if (kept?.size === stats.size && kept.mtimeMs === stats.mtimeMs) {
      return kept.value;
    }
    if (options.evicted === "pass" && keptByNameOnly(stats)) {
      return NOT_HERE_YET;
    }
    // Stat-ed before the read, so a change that lands during it is read
    // again next time.
    const value = this.#parse(
      await readText(file, { ...options, evicted: "wait" }),
      file,
    );
    this.#cache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, value });
    return value;
  }
}

async function withHandle<T>(
  file: string,
  { evicted = "wait", ownFolder }: ReadOptions,
  read: (handle: fs.promises.FileHandle) => Promise<T>,
): Promise<NotHereYet | T> {
  if (evicted === "pass" && keptByNameOnly(await fs.promises.stat(file))) {
    return NOT_HERE_YET;
  }
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
