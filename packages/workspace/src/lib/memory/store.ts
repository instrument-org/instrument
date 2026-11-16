import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { publisher } from "../../rpc/publisher";
import { type AbsolutePath } from "../../schemas/paths";
import { AbsolutePathSchema } from "../../schemas/paths";
import { MEMORY_FOLDER_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type DeviceId } from "../../schemas/device-id";
import { rewriteFileSync } from "../rewrite-file";
import { utcStamp } from "../utc-stamp";
import { chatIdNamedBy, splitFrontMatter } from "@instrument-org/shared";

import { isRecord } from "../skills";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import {
  type MemoryRecord,
  readMemoryRecords,
  writeMemoryRecords,
} from "./memory-records";

/**
 * What the conversation's agent keeps about the user across every chat: a
 * folder of Markdown files, one memory each, `Memory/` at the workspace's
 * top level, beside the chats and the drafts.
 *
 * Files rather than rows so the user can open the folder and read, edit, or
 * delete a memory with nothing but a file manager, and so a memory the agent
 * wrote and one the user typed into a new file are the same thing. Each file
 * is the memory's text alone; the chat it was learned in and when it last
 * changed are its record in the memory store (`memory-records.ts`).
 *
 * One file per memory rather than one list, because a memory is corrected by
 * being replaced under its name and forgotten by being deleted, and both are
 * one file operation the user can also do by hand.
 */

const FILE_EXTENSION = ".md";

/** How long a memory's name may be. A name is a slug saying what it is about. */
const MEMORY_NAME_MAX = 48;
/** How much one memory may hold. A memory is a fact, not a document. */
const MEMORY_TEXT_MAX = 2000;

export const MemoryNameSchema = z
  .string()
  .min(1)
  .max(MEMORY_NAME_MAX)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "A memory's name is lowercase words joined by hyphens, like pacific-time",
  );

export const MemorySchema = z.object({
  /** When it was saved or last corrected, in ms since the epoch. */
  at: z.number(),
  /** The chat it was learned in, when a chat saved it. */
  chat: ChatIdSchema.optional(),
  /** The file's name without its extension. */
  name: z.string(),
  /** Where the file is on disk, for a viewer that opens it. */
  path: z.string(),
  /** The memory, whole. */
  text: z.string(),
});

export type Memory = z.output<typeof MemorySchema>;

/**
 * Deletes the named memories' files and hands back what they held. Names with
 * no file are simply absent from the answer.
 *
 * Several at once rather than one at a time, because forgetting a dozen is
 * one decision a person made once: a call each would publish a change each,
 * and the list on screen would redraw its way down to the answer.
 */
export async function forgetMemories(
  dir: AbsolutePath,
  names: readonly string[],
): Promise<Memory[]> {
  const found = await Promise.all(names.map((name) => readMemory(dir, name)));
  const memories = found.flatMap((memory) => (memory ? [memory] : []));
  if (memories.length === 0) {
    return [];
  }
  await Promise.all(
    memories.map((memory) => fs.rm(memory.path, { force: true })),
  );
  writeMemoryRecords(
    dir,
    memories.map((memory) => ({
      fileName: `${memory.name}${FILE_EXTENSION}`,
      gone: true as const,
    })),
  );
  publisher.publish("memory.changed", null);
  return memories;
}

/** Deletes one memory's file. Returns what it held, or nothing when there was none. */
export async function forgetMemory(
  dir: AbsolutePath,
  name: string,
): Promise<Memory | undefined> {
  const [memory] = await forgetMemories(dir, [name]);
  return memory;
}

/**
 * Every memory, newest first, the order both the note and the list show them
 * in. Files that are not Markdown, and hidden ones, are not memories.
 */
export async function listMemories(dir: AbsolutePath): Promise<Memory[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = readMemoryRecords(dir);
  const memories = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isMemoryFileName(entry.name))
      .map((entry) => readMemoryFile(dir, entry.name, records)),
  );
  return memories
    .flatMap((memory) => (memory ? [memory] : []))
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

/**
 * What memory holds, as a fingerprint per name: what a session is recorded
 * as having been told, and what the memories of a later moment are compared
 * against to find which were saved, corrected, or forgotten since. The empty
 * set's digests are the empty record, which is also what a session that has
 * been told nothing is taken to know.
 */
export function memoryDigests(memories: Memory[]): Record<string, string> {
  return Object.fromEntries(
    memories.map((memory) => [
      memory.name,
      createHash("sha1").update(`${memory.at}\n${memory.text}`).digest("hex"),
    ]),
  );
}

/** Where memory lives in this workspace, `Memory/` at its top level. */
export function memoryDir(): AbsolutePath {
  return AbsolutePathSchema.parse(
    path.join(getWorkspaceConfig().rootDir, MEMORY_FOLDER_NAME),
  );
}

/** The first line of a memory, which is the fact when the rest is detail. */
export function memoryHeadline(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * One memory by name, or nothing when there is no such file. A name the
 * schema refuses is no memory either, before it reaches the path: the name
 * is joined onto the folder, and only a slug stays inside it.
 */
export async function readMemory(
  dir: AbsolutePath,
  name: string,
): Promise<Memory | undefined> {
  if (!MemoryNameSchema.safeParse(name).success) {
    return undefined;
  }
  return readMemoryFile(
    dir,
    `${name}${FILE_EXTENSION}`,
    readMemoryRecords(dir),
  );
}

/**
 * Keeps a memory under a name, replacing the one the name held: a fact that
 * supersedes another is saved to the same name, which is how memory stays one
 * corrected set rather than a pile. The file gets the text alone, and the
 * memory store the chat and the moment.
 */
export async function saveMemory(
  dir: AbsolutePath,
  { chat, name, text }: { chat?: Memory["chat"]; name: string; text: string },
): Promise<{ memory: Memory; replaced: boolean }> {
  const parsedName = MemoryNameSchema.parse(name);
  const body = text.trim();
  if (!body) {
    throw new Error("A memory needs some text.");
  }
  if (body.length > MEMORY_TEXT_MAX) {
    throw new Error(
      `A memory holds at most ${MEMORY_TEXT_MAX} characters; this one is ${body.length}. Keep the fact and leave the rest to the chat.`,
    );
  }
  // To the second, as the store says it, so the memory handed back is the
  // one a read gives.
  const at = Math.floor(Date.now() / 1000) * 1000;
  const fileName = `${parsedName}${FILE_EXTENSION}`;
  const filePath = path.join(dir, fileName);
  // Built from the file as it is when written: front matter in it that this
  // build does not know, left by the person or another program, stays.
  let replaced = false;
  rewriteFileSync(filePath, (held) => {
    replaced = held !== undefined;
    return memoryFile({ body, others: othersIn(held) });
  });
  writeMemoryRecords(dir, [
    {
      fileName,
      record: { ...(chat ? { chat } : {}), updated: utcStamp(new Date(at)) },
    },
  ]);
  publisher.publish("memory.changed", null);
  return {
    memory: {
      at,
      ...(chat ? { chat } : {}),
      name: parsedName,
      path: filePath,
      text: body,
    },
    replaced,
  };
}

/** Whether a name in the memory folder is a memory's: Markdown, and not hidden. */
function isMemoryFileName(name: string): boolean {
  return name.endsWith(FILE_EXTENSION) && !name.startsWith(".");
}

/**
 * One memory: the file's text, with the chat and the moment its record
 * names. A file with no record (one the person wrote, or renamed) is dated
 * by the file, unless front matter an earlier build wrote says otherwise,
 * which the launch takes into the store (`settleMemoryFiles`).
 */
async function readMemoryFile(
  dir: AbsolutePath,
  fileName: string,
  records: ReadonlyMap<string, MemoryRecord>,
): Promise<Memory | undefined> {
  const filePath = path.join(dir, fileName);
  let raw: string;
  let modifiedAt: number;
  try {
    [raw, modifiedAt] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath).then((stat) => stat.mtimeMs),
    ]);
  } catch {
    return undefined;
  }
  const name = fileName.slice(0, -FILE_EXTENSION.length);
  // A file the user wrote by hand has no front matter, and it is a memory
  // all the same.
  const { front, text } = splitMemoryFile(raw);
  if (!text) {
    return undefined;
  }
  const record = records.get(fileName) ?? recordInFront(front);
  const at = record ? Date.parse(record.updated) : modifiedAt;
  return {
    at,
    ...(record?.chat ? { chat: record.chat } : {}),
    name,
    path: filePath,
    text,
  };
}

/**
 * A memory file's front matter, where it has some that is YAML, and its
 * text. A file with none is all text.
 */
function splitMemoryFile(raw: string): {
  front: Record<string, unknown> | undefined;
  text: string;
} {
  const split = splitFrontMatter(raw);
  if (!split.ok) {
    return { front: undefined, text: raw.trim() };
  }
  let data: unknown;
  try {
    data = parseYaml(split.block) as unknown;
  } catch {
    data = {};
  }
  return {
    front: isRecord(data) ? data : undefined,
    text: split.body.replaceAll("\r\n", "\n").trim(),
  };
}

/**
 * The record front matter an earlier build wrote makes: its `chat` link and
 * its `updated` moment. Nothing where it names no moment.
 */
function recordInFront(
  front: Record<string, unknown> | undefined,
): MemoryRecord | undefined {
  const updated = front?.updated;
  const at =
    updated instanceof Date
      ? updated.getTime()
      : typeof updated === "string"
        ? Date.parse(updated)
        : Number.NaN;
  if (Number.isNaN(at)) {
    return undefined;
  }
  const chat = ChatIdSchema.safeParse(
    typeof front?.chat === "string" ? chatIdNamedBy(front.chat) : undefined,
  );
  return {
    ...(chat.success ? { chat: chat.data } : {}),
    updated: utcStamp(new Date(at)),
  };
}

/**
 * The file: the memory, under any front matter of anyone else's, as it was
 * found.
 */
function memoryFile({
  body,
  others,
}: {
  body: string;
  others: Record<string, unknown>;
}): string {
  if (Object.keys(others).length === 0) {
    return `${body}\n`;
  }
  return `---\n${stringifyYaml(others, { sortMapEntries: true }).trimEnd()}\n---\n${body}\n`;
}

/** The keys earlier builds wrote, and so the ones that are nobody else's. */
const OWN_KEYS = new Set(["chat", "updated"]);

/**
 * The keys the first 2.0 betas wrote: the chat's title (`from`), its
 * session (`thread`) and when (`at`). Theirs only where `at` comes with one
 * of the others and no `updated`, so a person's own `at` stays.
 */
const BETA_KEYS = new Set(["at", "from", "thread"]);

function isBetaFront(front: Record<string, unknown> | undefined): boolean {
  return (
    front !== undefined &&
    front.updated === undefined &&
    front.at !== undefined &&
    (front.from !== undefined || front.thread !== undefined)
  );
}

function isOwnKey(front: Record<string, unknown> | undefined, key: string) {
  return OWN_KEYS.has(key) || (isBetaFront(front) && BETA_KEYS.has(key));
}

/** What the first betas' front matter says, its session turned into the chat it was in where that chat is still here. */
function recordInBetaFront(
  front: Record<string, unknown> | undefined,
  chatOfSession: (session: string) => string | undefined,
): MemoryRecord | undefined {
  if (!isBetaFront(front)) {
    return undefined;
  }
  return recordInFront({
    ...(typeof front?.thread === "string" && chatOfSession(front.thread)
      ? { chat: chatOfSession(front.thread) }
      : {}),
    updated: front?.at,
  });
}

/** Each session's chat, read from the names of the chats' log files. */
async function sessionChats(
  rootDir: string,
): Promise<(session: string) => string | undefined> {
  const chatsDir = workspaceLayout(rootDir).chatsDir;
  const map = new Map<string, string>();
  for (const chat of await fs.readdir(chatsDir).catch(() => [])) {
    for (const name of await fs
      .readdir(path.join(chatsDir, chat))
      .catch(() => [])) {
      if (name.startsWith("ses_") && name.endsWith(".jsonl")) {
        map.set(name.split(".")[0] ?? name, chat);
      }
    }
  }
  return (session) => map.get(session);
}

/**
 * Front matter in what the file held that this build does not know, so a
 * correction keeps it. A file with none, or one nobody can parse, has
 * nothing to keep.
 */
function othersIn(held: string | undefined): Record<string, unknown> {
  const front = held === undefined ? undefined : splitMemoryFile(held).front;
  return Object.fromEntries(
    Object.entries(front ?? {}).filter(([key]) => !isOwnKey(front, key)),
  );
}

/** What the launch did to the memory files, for the boot log. */
export interface MemoryFilesSettled {
  /** A line per memory whose front matter went into the store. */
  done: string[];
  /** Each file left as it was, with why. */
  left: { reason: string; where: string }[];
}

/**
 * Takes the front matter earlier builds wrote into each memory file (the
 * `chat` it was learned in and when it was `updated`) into the memory store,
 * and writes the file back as the memory's text alone, under any front
 * matter of anyone else's. A file left with no text is deleted.
 *
 * Every launch, since a build before this one, on another computer sharing
 * the workspace, writes front matter back; a file with none is read and left
 * alone. What a file says is taken as of when the file was last written, so
 * a memory saved since, on any device, outranks it.
 */
export async function settleMemoryFiles(
  rootDir: string,
  device: DeviceId,
): Promise<MemoryFilesSettled> {
  const settled: MemoryFilesSettled = { done: [], left: [] };
  const dir = path.join(rootDir, MEMORY_FOLDER_NAME);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return settled;
  }
  let chatOfSession: ((session: string) => string | undefined) | undefined;
  for (const fileName of names.filter(isMemoryFileName).toSorted()) {
    const filePath = path.join(dir, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const { front, text } = splitMemoryFile(raw);
      if (!front || !Object.keys(front).some((key) => isOwnKey(front, key))) {
        continue;
      }
      const record = recordInFront(front) ??
        recordInBetaFront(
          front,
          (chatOfSession ??= await sessionChats(rootDir)),
        ) ?? {
        updated: utcStamp(stat.mtime),
      };
      writeMemoryRecords(
        dir,
        [{ at: stat.mtime.getTime(), fileName, record }],
        device,
      );
      if (!text) {
        await fs.rm(filePath, { force: true });
      } else {
        rewriteFileSync(filePath, (held) => {
          const now = held === undefined ? undefined : splitMemoryFile(held);
          return memoryFile({
            body: now?.text || text,
            others: othersIn(held ?? raw),
          });
        });
      }
      settled.done.push(
        `took ${fileName}'s front matter into the memory store`,
      );
    } catch (error) {
      settled.left.push({ reason: String(error), where: filePath });
    }
  }
  return settled;
}
