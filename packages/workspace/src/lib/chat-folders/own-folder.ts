import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { parallel } from "radashi";

import { CHAT_FILE_NAME } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { readJsonRecordSync, updateJsonRecord } from "../json-record-file";
import { keptByNameOnly } from "../workspace-files";
import { chatLinkedInText, LINK_HEAD_BYTES } from "./chat-transcript";

/**
 * Which folder under `Chats/` is each chat's own, on this computer.
 *
 * The name is kept in the workspace's machine folder (`chat-folders.json`,
 * by chat id), never beside the chat's records: each computer finds the
 * folder for itself, and a name in the synced records would be one more
 * file every computer rewrites. The name is where to look first. What says
 * a folder is a chat's is the `CHAT.md` in it, whose front matter names the
 * chat, so a folder a person renamed in a file manager is found again by the
 * chat it names, as long as no other chat claims it and it is the only one
 * that names this chat.
 */

/** How long a scan for a chat's folder may take before the log says so. */
const SLOW_SCAN_MS = 100;

/** How many `CHAT.md` files are read at once off the main thread. */
const READS_AT_ONCE = 8;

/** Each chat's folder name as this computer last recorded it, by chat id. */
export function chatFolderNames(machineDir: string): Map<string, string> {
  const read = readJsonRecordSync(namesFile(machineDir));
  if (read.kind !== "read") {
    return new Map();
  }
  return new Map(
    Object.entries(read.record).flatMap(([id, name]) =>
      typeof name === "string" && name !== "" ? [[id, name] as const] : [],
    ),
  );
}

/**
 * Records the name of a chat's folder on this computer, or forgets it with
 * `undefined` (a chat that is gone).
 */
export async function recordChatFolderName(
  machineDir: string,
  id: ChatId,
  name: string | undefined,
): Promise<void> {
  await updateJsonRecord(namesFile(machineDir), (names) =>
    names[id] === name ? undefined : { [id]: name },
  );
}

/**
 * The one folder directly under `chats` (the workspace's `Chats/`) whose
 * `CHAT.md` names this chat and that no other chat claims, or nothing when
 * there is none or more than one: two are a copy, and which one the chat
 * belongs in is the person's to say.
 *
 * Synchronous, for the callers that cannot wait, so a `CHAT.md` a cloud
 * service keeps by name only is passed over rather than downloaded: reading
 * one blocks the thread until it arrives. {@link findChatFolderNames} reads
 * those at launch and records what they name.
 */
export function folderLinkedTo(
  chats: string,
  id: ChatId,
  names: ReadonlyMap<string, string>,
): string | undefined {
  const startedAt = performance.now();
  const folders = unclaimedFolders(chats, id, names);
  const linked = folders.filter(
    (name) =>
      chatLinkedInFileSync(path.join(chats, name, CHAT_FILE_NAME)) === id,
  );
  const took = Math.round(performance.now() - startedAt);
  if (took >= SLOW_SCAN_MS) {
    console.warn(
      `Chat folders: looked for ${id}'s folder through ${folders.length} CHAT.md files in ${took}ms (${names.size} names recorded on this computer)`,
    );
  }
  return linked.length === 1 ? linked[0] : undefined;
}

/**
 * {@link folderLinkedTo} for a caller that can wait, which reads every
 * `CHAT.md`, downloading any a cloud service keeps by name only, off the
 * main thread.
 */
export async function folderLinkedToReading(
  chats: string,
  id: ChatId,
  names: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const folders = unclaimedFolders(chats, id, names);
  const links = await parallel({ limit: READS_AT_ONCE }, folders, (name) =>
    chatLinkedInFile(path.join(chats, name, CHAT_FILE_NAME)),
  );
  const linked = folders.filter((_, index) => links[index] === id);
  return linked.length === 1 ? linked[0] : undefined;
}

/**
 * Records the folder of each chat this computer has no folder name for,
 * where exactly one unclaimed folder's `CHAT.md` names it, from one pass
 * over `Chats/`. A computer that opens a workspace for the first time knows
 * none of them, and without the names every chat would look for its folder
 * through every `CHAT.md` each time it is asked. Returns how many it recorded.
 */
export async function findChatFolderNames({
  chats,
  isChat,
  machineDir,
}: {
  /** The workspace's `Chats/`. */
  chats: string;
  /** Whether an id is a chat's that is still there. */
  isChat: (id: ChatId) => boolean;
  machineDir: string;
}): Promise<number> {
  const names = chatFolderNames(machineDir);
  const claimed = new Set([...names.values()].map(comparable));
  const folders = foldersIn(chats).filter(
    (name) => !claimed.has(comparable(name)),
  );
  const links = await parallel({ limit: READS_AT_ONCE }, folders, (name) =>
    chatLinkedInFile(path.join(chats, name, CHAT_FILE_NAME)),
  );
  const found = new Map<ChatId, string[]>();
  for (const [index, id] of links.entries()) {
    const name = folders[index];
    if (
      id !== undefined &&
      name !== undefined &&
      !names.has(id) &&
      isChat(id)
    ) {
      found.set(id, [...(found.get(id) ?? []), name]);
    }
  }
  const unambiguous = Object.fromEntries(
    [...found].flatMap(([id, linked]) =>
      linked.length === 1 ? [[id, linked[0]] as const] : [],
    ),
  );
  if (Object.keys(unambiguous).length === 0) {
    return 0;
  }
  let recorded = 0;
  await updateJsonRecord(namesFile(machineDir), (current) => {
    const unrecorded = Object.fromEntries(
      Object.entries(unambiguous).filter(([id]) => current[id] === undefined),
    );
    recorded = Object.keys(unrecorded).length;
    return recorded === 0 ? undefined : unrecorded;
  });
  return recorded;
}

/** The folders under `chats` that no chat other than `id` claims by name. */
function unclaimedFolders(
  chats: string,
  id: ChatId,
  names: ReadonlyMap<string, string>,
): string[] {
  const claimed = new Set(
    [...names].flatMap(([owner, name]) =>
      owner === id ? [] : [comparable(name)],
    ),
  );
  return foldersIn(chats).filter((name) => !claimed.has(comparable(name)));
}

/**
 * A folder's name as it compares: composed, which is the form a name is
 * written in, so a listing that gives back the decomposed one still matches
 * the name recorded for a chat.
 */
function comparable(name: string): string {
  return name.normalize("NFC");
}

/** The chat the `CHAT.md` in `folder` names, if it has one of ours. */
export function chatLinkedInFolder(folder: string): ChatId | undefined {
  return chatLinkedInFileSync(path.join(folder, CHAT_FILE_NAME));
}

/**
 * Nothing for a file a cloud service keeps by name only, which is left
 * unread. A file this passes over by mistake is read by
 * {@link findChatFolderNames} anyway.
 */
function chatLinkedInFileSync(file: string): ChatId | undefined {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, "r");
    if (keptByNameOnly(fs.fstatSync(handle))) {
      return undefined;
    }
    const buffer = Buffer.alloc(LINK_HEAD_BYTES);
    const bytesRead = fs.readSync(handle, buffer, 0, LINK_HEAD_BYTES, 0);
    return chatLinkedInText(buffer.toString("utf8", 0, bytesRead));
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

async function chatLinkedInFile(file: string): Promise<ChatId | undefined> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, "r");
    const buffer = Buffer.alloc(LINK_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, LINK_HEAD_BYTES, 0);
    return chatLinkedInText(buffer.toString("utf8", 0, bytesRead));
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** The folders directly under `chats`, by name, hidden ones aside. */
export function foldersIn(chats: string): string[] {
  try {
    return fs
      .readdirSync(chats, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") ? [entry.name] : [],
      );
  } catch {
    return [];
  }
}

function namesFile(machineDir: string): string {
  return path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders);
}
