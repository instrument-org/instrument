import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { MEMORY_DIR_NAME } from "../../constants";
import { publisher } from "../../rpc/publisher";
import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { isRecord, splitFrontmatter } from "../skills";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * What the conversation's agent keeps about the user across every thread: a
 * folder of Markdown files, one memory each, at the workspace root beside the
 * apps and skills folders.
 *
 * Files rather than rows so the user can open the folder and read, edit, or
 * delete a memory with nothing but a file manager, and so a memory the agent
 * wrote and one the user typed into a new file are the same thing. Each file
 * is the memory's text under a short frontmatter saying where it came from
 * and when; a file with no frontmatter at all is still a memory, read whole.
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
  /** The thread it was learned in, when a thread saved it. */
  from: z
    .object({
      sessionId: z.string().optional(),
      title: z.string(),
    })
    .optional(),
  /** The file's name without its extension. */
  name: z.string(),
  /** Where the file is on disk, for a viewer that opens it. */
  path: z.string(),
  /** The memory, whole. */
  text: z.string(),
});

export type Memory = z.output<typeof MemorySchema>;

/** Makes the folder, so it can be opened before anything is in it. */
export async function ensureMemoryDir(dir: AbsolutePath): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

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
  const memories = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(FILE_EXTENSION) &&
          !entry.name.startsWith("."),
      )
      .map((entry) => readMemoryFile(dir, entry.name)),
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

/** Where memory lives in this workspace. */
export function memoryDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, MEMORY_DIR_NAME);
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
  return readMemoryFile(dir, `${name}${FILE_EXTENSION}`);
}

/**
 * Keeps a memory under a name, replacing the one the name held: a fact that
 * supersedes another is saved to the same name, which is how memory stays one
 * corrected set rather than a pile.
 */
export async function saveMemory(
  dir: AbsolutePath,
  { from, name, text }: { from?: Memory["from"]; name: string; text: string },
): Promise<{ memory: Memory; replaced: boolean }> {
  const parsedName = MemoryNameSchema.parse(name);
  const body = text.trim();
  if (!body) {
    throw new Error("A memory needs some text.");
  }
  if (body.length > MEMORY_TEXT_MAX) {
    throw new Error(
      `A memory holds at most ${MEMORY_TEXT_MAX} characters; this one is ${body.length}. Keep the fact and leave the rest to the thread.`,
    );
  }
  const at = Date.now();
  const filePath = path.join(dir, `${parsedName}${FILE_EXTENSION}`);
  const replaced = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, serialize({ at, body, from }), "utf8");
  publisher.publish("memory.changed", null);
  return {
    memory: {
      at,
      ...(from ? { from } : {}),
      name: parsedName,
      path: filePath,
      text: body,
    },
    replaced,
  };
}

async function readMemoryFile(
  dir: AbsolutePath,
  fileName: string,
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
  const split = splitFrontmatter(raw);
  // A file the user wrote by hand has no frontmatter, and it is a memory all
  // the same: its text, dated by the file.
  if (!split.ok) {
    const text = raw.trim();
    return text ? { at: modifiedAt, name, path: filePath, text } : undefined;
  }
  let data: unknown;
  try {
    data = parseYaml(split.block) as unknown;
  } catch {
    data = {};
  }
  const record = isRecord(data) ? data : {};
  const text = split.body.trim();
  if (!text) {
    return undefined;
  }
  const at =
    typeof record.at === "string" && !Number.isNaN(Date.parse(record.at))
      ? Date.parse(record.at)
      : modifiedAt;
  const from =
    typeof record.from === "string" && record.from.trim()
      ? {
          ...(typeof record.thread === "string" && record.thread
            ? { sessionId: record.thread }
            : {}),
          title: record.from.trim(),
        }
      : undefined;
  return { at, ...(from ? { from } : {}), name, path: filePath, text };
}

/**
 * The file: frontmatter naming the thread and the moment, then the memory.
 * String values are written as JSON, which YAML reads as a quoted scalar, so
 * a thread title holding a colon or a quote round-trips.
 */
function serialize({
  at,
  body,
  from,
}: {
  at: number;
  body: string;
  from: Memory["from"];
}): string {
  const lines = ["---"];
  if (from) {
    lines.push(`from: ${JSON.stringify(from.title)}`);
    if (from.sessionId) {
      lines.push(`thread: ${JSON.stringify(from.sessionId)}`);
    }
  }
  lines.push(`at: ${new Date(at).toISOString()}`, "---", body, "");
  return lines.join("\n");
}
