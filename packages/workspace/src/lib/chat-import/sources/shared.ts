import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";

import type { ImportedMessage, ImportOmitted } from "../model";

/**
 * Pieces every local source shares: reading a log a line at a time without
 * holding the file, remembering what a file listed as until it changes, and
 * folding a log's records into the messages a person would recognize.
 */

/** Files a listing reads at once: enough to hide disk latency, never a flood. */
export const FILES_AT_ONCE = 4;

const NEWLINE = 0x0a;

/** Whether this runtime can read a zstd-compressed log (Node 22.15 and later). */
export const canReadZstd = typeof zlib.createZstdDecompress === "function";

/**
 * Each line of a file as raw bytes, in order, holding at most one chunk and
 * one line at a time. A `.zst` file is decompressed as it streams.
 */
export async function* readLines(filePath: string): AsyncGenerator<Buffer> {
  const file = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
  const input: Readable = filePath.endsWith(".zst")
    ? file.pipe(zlib.createZstdDecompress())
    : file;
  let carry: Buffer | undefined;
  try {
    for await (const chunk of input) {
      if (!Buffer.isBuffer(chunk)) {
        continue;
      }
      let start = 0;
      let end = chunk.indexOf(NEWLINE, start);
      while (end !== -1) {
        const piece = chunk.subarray(start, end);
        if (carry) {
          yield Buffer.concat([carry, piece]);
          carry = undefined;
        } else if (piece.length > 0) {
          yield piece;
        }
        start = end + 1;
        end = chunk.indexOf(NEWLINE, start);
      }
      if (start < chunk.length) {
        const rest = chunk.subarray(start);
        carry = carry ? Buffer.concat([carry, rest]) : Buffer.from(rest);
      }
    }
    if (carry && carry.length > 0) {
      yield carry;
    }
  } finally {
    file.destroy();
  }
}

/** A line parsed as a JSON object, or undefined for anything else. */
export function parseRecord(
  line: Buffer | string,
): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line.toString());
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A timestamp a source wrote (ISO text or epoch milliseconds), or undefined. */
export function dateOf(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The `"timestamp":"…"` nearest the end of a line, read without parsing it. */
export function lastTimestamp(line: Buffer): Date | undefined {
  const key = '"timestamp":"';
  const at = line.lastIndexOf(key);
  if (at === -1) {
    return undefined;
  }
  const start = at + key.length;
  const end = line.indexOf('"', start);
  return end === -1 ? undefined : dateOf(line.toString("latin1", start, end));
}

/** A path as a person writes it, with `~` for the home folder. */
export function homeRelative(filePath: string, homeDir: string): string {
  const relative = path.relative(homeDir, filePath);
  if (relative === "") {
    return "~";
  }
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? filePath
    : ["~", ...relative.split(path.sep)].join("/");
}

const TITLE_LENGTH = 80;
const PREVIEW_LENGTH = 200;

/** A title from the opening ask: its first line, cut at a word near 80 characters. */
export function titleFrom(text: string): string {
  const line = text.trim().split("\n", 1)[0]?.trim() ?? "";
  return clip(line, TITLE_LENGTH);
}

/** The opening ask's first words, on one line. */
export function previewFrom(text: string): string {
  return clip(text.replaceAll(/\s+/g, " ").trim(), PREVIEW_LENGTH);
}

function clip(text: string, length: number): string {
  if (text.length <= length) {
    return text;
  }
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * What a file listed as, kept until the file changes size or modified time,
 * so listing a source again reads only what changed since.
 */
export class FileCache<T> {
  readonly #entries = new Map<
    string,
    { mtimeMs: number; size: number; value: T }
  >();

  async get(filePath: string, read: () => Promise<T>): Promise<T | undefined> {
    const stat = await fs.promises.stat(filePath).catch(() => undefined);
    if (!stat) {
      this.#entries.delete(filePath);
      return undefined;
    }
    const cached = this.#entries.get(filePath);
    if (
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.value;
    }
    const value = await read();
    this.#entries.set(filePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      value,
    });
    return value;
  }

  /** Forgets every file not in `keep`, so a deleted log does not linger. */
  retain(keep: ReadonlySet<string>): void {
    for (const key of this.#entries.keys()) {
      if (!keep.has(key)) {
        this.#entries.delete(key);
      }
    }
  }
}

/** One record's part in the conversation, as the folder below takes it. */
export interface UserPart {
  attachments?: number;
  at: Date;
  text: string;
}

export interface AssistantPart {
  at: Date;
  model?: string;
  /** Text, or `true` when listing and only whether there was any matters. */
  text?: string | true;
  /** The tools called, a name per call. */
  tools?: readonly string[];
}

export interface FoldedConversation {
  /** Messages with their text; empty when the folder was only counting. */
  messages: ImportedMessage[];
  count: number;
  /** The first thing the person said, for a title and a preview. */
  firstPrompt?: string;
  createdAt?: Date;
  updatedAt?: Date;
  /** Whether the person said anything. */
  prompted: boolean;
  /** Whether the AI replied at all. */
  replied: boolean;
}

/**
 * Folds a log's records into messages: every assistant record between two
 * things the person said is one reply, its text joined and its tool calls
 * counted by name. A record with nothing to say (an injected note filtered
 * to empty, a reply that only thought) adds nothing and splits no reply.
 *
 * With `keepText` off it only counts, holding no message text, which is
 * what a listing over thousands of logs needs.
 */
export class ConversationFolder {
  readonly #keepText: boolean;
  readonly #messages: ImportedMessage[] = [];
  #count = 0;
  #reply:
    | { at: Date; model?: string; text: string[]; tools: Map<string, number> }
    | undefined;
  #firstPrompt: string | undefined;
  #createdAt: Date | undefined;
  #updatedAt: Date | undefined;
  #prompted = false;
  #replied = false;

  constructor({ keepText }: { keepText: boolean }) {
    this.#keepText = keepText;
  }

  user(part: UserPart): void {
    const text = part.text.trim();
    if (text === "" && !part.attachments) {
      return;
    }
    this.#closeReply();
    this.activity(part.at);
    this.#prompted = true;
    this.#firstPrompt ??= text === "" ? undefined : text;
    this.#count += 1;
    if (this.#keepText) {
      this.#messages.push({
        createdAt: part.at,
        role: "user",
        text,
        ...(part.attachments
          ? { omitted: { attachments: part.attachments } }
          : {}),
      });
    }
  }

  assistant(part: AssistantPart): void {
    const text = part.text === true ? true : part.text?.trim();
    const tools = part.tools ?? [];
    if (!text && tools.length === 0) {
      return;
    }
    this.activity(part.at);
    this.#reply ??= { at: part.at, text: [], tools: new Map() };
    if (part.model) {
      this.#reply.model ??= part.model;
    }
    if (typeof text === "string") {
      this.#reply.text.push(text);
    } else if (text) {
      this.#reply.text.push("");
    }
    for (const tool of tools) {
      this.#reply.tools.set(tool, (this.#reply.tools.get(tool) ?? 0) + 1);
    }
  }

  /** Something happened at this time (a tool's result), with nothing to show. */
  activity(at: Date | undefined): void {
    if (!at) {
      return;
    }
    if (!this.#createdAt || at < this.#createdAt) {
      this.#createdAt = at;
    }
    if (!this.#updatedAt || at > this.#updatedAt) {
      this.#updatedAt = at;
    }
  }

  finish(): FoldedConversation {
    this.#closeReply();
    return {
      count: this.#count,
      createdAt: this.#createdAt,
      firstPrompt: this.#firstPrompt,
      messages: this.#messages,
      prompted: this.#prompted,
      replied: this.#replied,
      updatedAt: this.#updatedAt,
    };
  }

  #closeReply(): void {
    const reply = this.#reply;
    if (!reply) {
      return;
    }
    this.#reply = undefined;
    this.#replied = true;
    this.#count += 1;
    if (!this.#keepText) {
      return;
    }
    const omitted: ImportOmitted =
      reply.tools.size > 0
        ? { toolCalls: Object.fromEntries(reply.tools) }
        : {};
    this.#messages.push({
      createdAt: reply.at,
      role: "assistant",
      text: reply.text.filter((text) => text !== "").join("\n\n"),
      ...(reply.model ? { model: reply.model } : {}),
      ...(omitted.toolCalls ? { omitted } : {}),
    });
  }
}
