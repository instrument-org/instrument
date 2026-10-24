import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { chatIds, chatsDir, sessionOfChat } from "../record-folders";
import { parseRecordFileName } from "../records/file-names";
import { type ImportedFrom, ImportedFromSchema, importKey } from "./model";

/** How much of a log is read for its header, which is one short line. */
const HEADER_BYTES = 16 * 1024;

/** How many chats' headers are read at once. */
const READ_LIMIT = 16;

/**
 * Where each chat this process has looked at came from, null for one that
 * was not imported, by the chats folder it is in. A session header is never
 * rewritten, so what one says is read once.
 */
const seen = new Map<string, Map<ChatId, ImportedFrom | null>>();

function seenIn(root: string): Map<ChatId, ImportedFrom | null> {
  let known = seen.get(root);
  if (!known) {
    known = new Map();
    seen.set(root, known);
  }
  return known;
}

/**
 * The chats already brought in, by `importKey`: read from the header of each
 * chat's own session, the first line of its logs, and nothing else of it.
 * Where two chats name the same source chat (two computers importing it
 * before they synced), the one with the smaller id answers.
 */
export async function importedChats(): Promise<Map<string, ChatId>> {
  const root = chatsDir();
  const known = seenIn(root);
  const ids = chatIds().toSorted();
  const unread = ids.filter((id) => !known.has(id));
  await parallel({ limit: READ_LIMIT }, unread, async (id) => {
    known.set(id, await importedFromHeader(root, id));
  });
  const byKey = new Map<string, ChatId>();
  for (const id of ids) {
    const from = known.get(id);
    if (from && !byKey.has(importKey(from))) {
      byKey.set(importKey(from), id);
    }
  }
  return byKey;
}

/** Notes a chat this process just imported, so the next look need not read it. */
export function rememberImported(id: ChatId, from: ImportedFrom): void {
  seenIn(chatsDir()).set(id, from);
}

/**
 * What the chat's own session header names as its source, from any of that
 * session's logs (every log of a session repeats its header), or null.
 */
async function importedFromHeader(
  root: string,
  id: ChatId,
): Promise<ImportedFrom | null> {
  const session = sessionOfChat(id);
  if (!session) {
    return null;
  }
  const folder = path.join(root, id);
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return null;
  }
  for (const name of names.toSorted()) {
    const parsed = parseRecordFileName(name);
    if (
      parsed?.kind !== "log" ||
      parsed.session !== session ||
      parsed.copy !== undefined
    ) {
      continue;
    }
    const from = importedIn(await firstLineOf(path.join(folder, name)));
    if (from) {
      return from;
    }
  }
  return null;
}

/** The `imported` a header line names, read without the record schemas. */
function importedIn(line: string | undefined): ImportedFrom | undefined {
  if (line === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("t" in value) ||
    value.t !== "session" ||
    !("imported" in value)
  ) {
    return undefined;
  }
  const parsed = ImportedFromSchema.safeParse(value.imported);
  return parsed.success ? parsed.data : undefined;
}

async function firstLineOf(file: string): Promise<string | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const end = text.indexOf("\n");
    return end === -1 ? undefined : text.slice(0, end);
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}
