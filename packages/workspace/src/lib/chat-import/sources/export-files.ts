import { BlobReader, type FileEntry, ZipReader } from "@zip.js/zip.js";
import { createReadStream, openAsBlob } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ImportCandidate, ImportedTranscript } from "../model";

/**
 * The files of a chat service's export, read the same way whether the person
 * picked the `.zip` or the folder it was unpacked to.
 *
 * A zip is read through its central directory, so only the members asked for
 * are ever inflated, and the file itself is never read whole: `openAsBlob` is
 * a lazy, file-backed `Blob` that zip.js reads ranges from. An export with
 * gigabytes of images costs what its JSON costs.
 */
export type ExportFiles = {
  /** Every file, by its path inside the export with `/` separators. */
  names: readonly string[];
  /** One file's bytes as they inflate or come off the disk. */
  stream(name: string): AsyncIterable<Uint8Array>;
};

/** Thrown when a path is not a zip or folder that can be read at all. */
export class UnreadableExportError extends Error {}

const FOLDER_DEPTH = 3;

export async function openExportFiles(
  exportPath: string,
): Promise<ExportFiles> {
  const stats = await stat(exportPath).catch(() => undefined);
  if (!stats) {
    throw new UnreadableExportError("That file couldn't be found.");
  }
  if (stats.isDirectory()) {
    return {
      names: await listFolder(exportPath, "", FOLDER_DEPTH),
      stream: (name) => createReadStream(path.join(exportPath, name)),
    };
  }
  return await openZip(exportPath);
}

/** What every zip starts with, `PK\x03\x04`, damaged or not. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

async function openZip(zipPath: string): Promise<ExportFiles> {
  const blob = await openAsBlob(zipPath);
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  let entries: FileEntry[];
  try {
    entries = (await reader.getEntries()).filter(
      (entry): entry is FileEntry => !entry.directory,
    );
  } catch (error) {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (ZIP_SIGNATURE.every((byte, index) => head[index] === byte)) {
      throw new UnreadableExportError(
        "This zip file couldn't be opened. It might be damaged, or it might not have finished downloading.",
        { cause: error },
      );
    }
    throw error;
  }
  const byName = new Map(entries.map((entry) => [entry.filename, entry]));
  return {
    names: [...byName.keys()],
    stream(name) {
      const entry = byName.get(name);
      if (!entry) {
        throw new Error(`The export has no ${name}.`);
      }
      return inflate(entry);
    },
  };
}

/**
 * One member's bytes, handed over a chunk at a time: zip.js waits for each
 * chunk to be taken before inflating the next, so a member is never held
 * whole. A consumer that stops early fails the next write, which ends the
 * inflate; that failure is the stop, so nothing is thrown for it.
 */
async function* inflate(entry: FileEntry): AsyncIterable<Uint8Array> {
  type Step = { chunk: Uint8Array } | { done: true } | { error: unknown };
  let deliver: ((step: Step) => void) | undefined;
  let taken: (() => void) | undefined;
  let pending: Step | undefined;
  let stopped = false;
  const send = (step: Step) => {
    if (deliver) {
      const resolve = deliver;
      deliver = undefined;
      resolve(step);
    } else {
      pending = step;
    }
  };
  const writable = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        if (stopped) {
          reject(new Error("Stopped reading."));
          return;
        }
        taken = resolve;
        send({ chunk });
      }),
  });
  entry.getData(writable).then(
    () => send({ done: true }),
    (error: unknown) => send({ error }),
  );
  try {
    while (true) {
      const step =
        pending ??
        (await new Promise<Step>((resolve) => {
          deliver = resolve;
        }));
      pending = undefined;
      if ("error" in step) {
        throw step.error;
      }
      if ("done" in step) {
        return;
      }
      yield step.chunk;
      const resume = taken;
      taken = undefined;
      resume?.();
    }
  } finally {
    stopped = true;
    const resume = taken;
    taken = undefined;
    resume?.();
  }
}

async function listFolder(
  root: string,
  relative: string,
  depth: number,
): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isFile()) {
      names.push(name);
    } else if (entry.isDirectory() && depth > 1) {
      names.push(...(await listFolder(root, name, depth - 1)));
    }
  }
  return names;
}

/**
 * Where an export's own files are: the folder nearest the top holding a file
 * `matches` accepts, so an export unpacked inside a folder of its own reads
 * the same as one at the top. Returns that folder's prefix (`""` or
 * `"export/"`) and the matching files in it, sorted, or undefined.
 */
export function locate(
  names: readonly string[],
  matches: (baseName: string) => boolean,
): { prefix: string; files: string[] } | undefined {
  let best: { prefix: string; files: string[] } | undefined;
  for (const name of names) {
    if (name.startsWith("__MACOSX/")) {
      continue;
    }
    const slash = name.lastIndexOf("/");
    const prefix = name.slice(0, slash + 1);
    if (!matches(name.slice(slash + 1))) {
      continue;
    }
    const depth = prefix.split("/").length;
    const bestDepth = best ? best.prefix.split("/").length : Infinity;
    if (!best || depth < bestDepth) {
      best = { prefix, files: [name] };
    } else if (prefix === best.prefix) {
      best.files.push(name);
    }
  }
  best?.files.sort();
  return best;
}

// ---
// JSON
// ---

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * Each object in a JSON file whose top level is an array, parsed one at a
 * time as the bytes arrive.
 *
 * An export's conversations file runs to hundreds of megabytes, past what one
 * JavaScript string can be, so it is never decoded whole: the scanner finds
 * where each top-level object starts and ends (structural characters are all
 * ASCII, so splitting the UTF-8 bytes there is safe) and parses just that
 * object. An object that does not parse is skipped, and a file whose top
 * level is not an array yields nothing.
 */
export async function* jsonArrayObjects(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let depth = 0;
  let rootIsArray = false;
  let inString = false;
  let escaped = false;
  let pieces: Uint8Array[] = [];
  let collecting = false;
  for await (const chunk of chunks) {
    let start = collecting ? 0 : -1;
    for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (byte === BACKSLASH) {
          escaped = true;
        } else if (byte === QUOTE) {
          inString = false;
        }
        continue;
      }
      if (byte === QUOTE) {
        inString = true;
      } else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
        depth++;
        if (depth === 1) {
          rootIsArray = byte === OPEN_BRACKET;
        } else if (depth === 2 && rootIsArray && byte === OPEN_BRACE) {
          collecting = true;
          start = index;
        }
      } else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
        if (depth === 2 && collecting) {
          pieces.push(chunk.subarray(start, index + 1));
          const json = decoder.decode(Buffer.concat(pieces));
          pieces = [];
          collecting = false;
          start = -1;
          const parsed = parseQuietly(json);
          if (parsed !== undefined) {
            yield parsed;
          }
        }
        depth--;
      }
    }
    if (collecting) {
      pieces.push(chunk.slice(start));
    }
  }
}

function parseQuietly(json: string): unknown {
  try {
    const value: unknown = JSON.parse(json);
    return value;
  } catch {
    return undefined;
  }
}

/** A whole JSON file, for the small ones beside the conversations. */
export async function readJson(
  files: ExportFiles,
  name: string,
): Promise<unknown> {
  const pieces: Uint8Array[] = [];
  for await (const chunk of files.stream(name)) {
    pieces.push(chunk);
  }
  return parseQuietly(new TextDecoder().decode(Buffer.concat(pieces)));
}

// ---
// Fields
// ---
// Every field in an export is read as optional and as possibly the wrong
// type: the services change their shapes without notice.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A date from epoch seconds or an ISO string, or undefined. */
export function dateOf(value: unknown): Date | undefined {
  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : typeof value === "string" && value
        ? new Date(value)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

// ---
// Candidates
// ---

const PREVIEW_LENGTH = 140;
const TITLE_LENGTH = 60;

function firstWords(words: string, length: number): string {
  const flat = words.replaceAll(/\s+/g, " ").trim();
  return flat.length > length
    ? `${flat.slice(0, length - 1).trimEnd()}…`
    : flat;
}

/**
 * The fields a transcript is listed by, worked out from its messages: the
 * title falls back to the opening ask, and a chat nobody replied to (or that
 * the person never wrote in) is incidental.
 */
export function finishTranscript(
  transcript: Omit<ImportedTranscript, "preview" | "incidental">,
): ImportedTranscript {
  const opening = transcript.messages.find(
    (message) => message.role === "user" && message.text.trim(),
  );
  const replied = transcript.messages.some(
    (message) => message.role === "assistant",
  );
  const preview = opening
    ? firstWords(opening.text, PREVIEW_LENGTH)
    : undefined;
  const title =
    transcript.title.trim() ||
    (opening ? firstWords(opening.text, TITLE_LENGTH) : "");
  return {
    ...transcript,
    title,
    ...(preview ? { preview } : {}),
    ...(!opening || !replied ? { incidental: true } : {}),
  };
}

export function candidateOf(transcript: ImportedTranscript): ImportCandidate {
  return { ...transcript, messages: transcript.messages.length };
}

/** Newest first, the order every listing is in. */
export function newestFirst(a: ImportCandidate, b: ImportCandidate): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}
