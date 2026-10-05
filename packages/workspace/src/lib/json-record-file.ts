import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sleep } from "radashi";

import { createWriteQueue } from "./create-write-queue";
import { TypedError } from "./errors";

/**
 * The one way the workspace writes a JSON file it keeps: a task's or a chat's
 * settings, the window's state, a topic's settings, and what the migrations
 * rewrite of them.
 *
 * - **Atomic.** Written to a temporary file and renamed into place, so a
 *   reader sees the old file or the new one and a crash mid-write leaves the
 *   old one. A truncated file does not read as damaged: it reads as a record
 *   with nothing in it, which costs a task its name and its place in the list.
 * - **Ordered.** Updates to one path from this process queue behind each
 *   other, so a read-modify-write never builds on a file another write is
 *   about to replace. The synchronous update has no queue to join and is for
 *   code that runs before anything else writes (the boot migrations).
 * - **Carried forward.** An update returns the fields it changes and every
 *   other field stays as the file had it, so a field this build cannot read,
 *   written by a newer one, survives the next write.
 * - **Refused when unreadable.** A file that is there and cannot be read as a
 *   JSON object is never written over: what this build would write is its own
 *   empty reading of it plus a change, which would replace everything the file
 *   held. `set-aside` moves a file that opens but does not parse beside it
 *   first, for a file whose loss costs nothing worth refusing a write for.
 *
 * Writes from two processes sharing a workspace are still unordered, and the
 * last rename wins: the temporary file is named per process only so they
 * cannot write into each other's.
 */
export type JsonRecord = Record<string, unknown>;

export type JsonRecordRead =
  | { cause: unknown; kind: "unreadable"; opened: boolean }
  | { kind: "missing" }
  | { kind: "read"; record: JsonRecord };

interface UpdateOptions {
  /** What to do with a file that opens but is not a JSON object. Refused unless said. */
  unreadable?: "refuse" | "set-aside";
}

/** How long a rename another program is holding the file against is retried. */
const RENAME_RETRY_MS = 1000;
/** The first wait, and the step each further attempt adds to it. */
const RENAME_RETRY_STEP_MS = 20;

const enqueue = createWriteQueue();

export async function readJsonRecord(file: string): Promise<JsonRecordRead> {
  let contents: string;
  try {
    contents = await fs.readFile(file, "utf8");
  } catch (error) {
    return isNotFound(error)
      ? { kind: "missing" }
      : { cause: error, kind: "unreadable", opened: false };
  }
  return parsed(contents);
}

export function readJsonRecordSync(file: string): JsonRecordRead {
  let contents: string;
  try {
    contents = syncFs.readFileSync(file, "utf8");
  } catch (error) {
    return isNotFound(error)
      ? { kind: "missing" }
      : { cause: error, kind: "unreadable", opened: false };
  }
  return parsed(contents);
}

/**
 * Renames a temporary file into place, waiting out a refusal.
 *
 * Windows fails a rename with EPERM while another process holds either file
 * open, and something always does on a real machine: a virus scanner reads
 * what was just written, a search indexer walks the directory. The handle is
 * held for a moment, so retrying turns a write that was lost outright into
 * one that is late. POSIX has no such failure and loses nothing by asking
 * again.
 */
async function renameWhenAllowed(
  temporary: string,
  target: string,
): Promise<void> {
  const deadline = Date.now() + RENAME_RETRY_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(temporary, target);
      return;
    } catch (error) {
      if (!isBusy(error) || Date.now() >= deadline) {
        throw error;
      }
    }
    // Backing off rather than spinning: the handle is another program's and
    // nothing here can shorten how long it keeps it.
    await sleep(RENAME_RETRY_STEP_MS * attempt);
  }
}

/**
 * Applies a change to a JSON file, read and written inside the path's queue.
 * `change` gets the file as it is (empty when there is none) and returns the
 * fields to write over it, a field set to `undefined` to drop it, or nothing
 * to leave the file alone. Answers with the file as it stands afterward.
 */
export function updateJsonRecord(
  file: string,
  change: (record: JsonRecord) => JsonRecord | undefined,
  options: UpdateOptions = {},
): Promise<JsonRecord> {
  return enqueue(file, async () => {
    const current = await writableRecord(file, options);
    const changes = change(current);
    if (changes === undefined) {
      return current;
    }
    const next = merged(current, changes);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = temporaryPath(file);
    try {
      await fs.writeFile(temporary, serialized(next), "utf8");
      await renameWhenAllowed(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return next;
  });
}

/**
 * `updateJsonRecord` for code that cannot wait: atomic and carried forward
 * the same, with no queue, so it is for writes nothing else in the process is
 * making at the same time.
 */
export function updateJsonRecordSync(
  file: string,
  change: (record: JsonRecord) => JsonRecord | undefined,
  options: UpdateOptions = {},
): JsonRecord {
  const read = readJsonRecordSync(file);
  if (read.kind === "unreadable") {
    if (options.unreadable !== "set-aside" || !read.opened) {
      throw refusal(file, read.cause);
    }
    syncFs.renameSync(file, asidePath(file));
  }
  const current = read.kind === "read" ? read.record : {};
  const changes = change(current);
  if (changes === undefined) {
    return current;
  }
  const next = merged(current, changes);
  syncFs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryPath(file);
  try {
    syncFs.writeFileSync(temporary, serialized(next), "utf8");
    syncFs.renameSync(temporary, file);
  } catch (error) {
    syncFs.rmSync(temporary, { force: true });
    throw error;
  }
  return next;
}

/** Where a file that does not parse is moved, beside it, when it is set aside. */
function asidePath(file: string): string {
  return `${file}.unreadable-${Date.now()}`;
}

function isBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" ||
      error.code === "EACCES" ||
      error.code === "EBUSY")
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merged(current: JsonRecord, changes: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries({ ...current, ...changes }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

/** Valid JSON holding an array, a number or `null` is as unreadable as truncated JSON. */
function parsed(contents: string): JsonRecordRead {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    return { cause: error, kind: "unreadable", opened: true };
  }
  return isRecord(value)
    ? { kind: "read", record: value }
    : {
        cause: new Error("Not a JSON object"),
        kind: "unreadable",
        opened: true,
      };
}

function refusal(file: string, cause: unknown): TypedError.FileSystem {
  return new TypedError.FileSystem(
    `Refusing to overwrite an unreadable file at ${file}`,
    { cause },
  );
}

function serialized(record: JsonRecord): string {
  return JSON.stringify(record, null, 2);
}

/** Named per process, so two instances sharing a workspace never write each other's. */
function temporaryPath(file: string): string {
  return `${file}.${process.pid}.tmp`;
}

/** The file's record to build on, or the refusal to build on it. */
async function writableRecord(
  file: string,
  { unreadable = "refuse" }: UpdateOptions,
): Promise<JsonRecord> {
  const read = await readJsonRecord(file);
  if (read.kind === "read") {
    return read.record;
  }
  if (read.kind === "missing") {
    return {};
  }
  if (unreadable !== "set-aside" || !read.opened) {
    throw refusal(file, read.cause);
  }
  await fs.rename(file, asidePath(file));
  return {};
}
