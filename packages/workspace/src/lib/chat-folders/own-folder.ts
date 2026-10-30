import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { CHAT_FILE_NAME } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { readJsonRecordSync, updateJsonRecord } from "../json-record-file";
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
 */
export function folderLinkedTo(
  chats: string,
  id: ChatId,
  names: ReadonlyMap<string, string>,
): string | undefined {
  const claimed = new Set(
    [...names].flatMap(([owner, name]) =>
      owner === id ? [] : [comparable(name)],
    ),
  );
  const startedAt = performance.now();
  const folders = foldersIn(chats);
  const linked = folders.filter(
    (name) =>
      !claimed.has(comparable(name)) &&
      chatLinkedInFileSync(path.join(chats, name, CHAT_FILE_NAME)) === id,
  );
  // Every read here blocks the thread it runs on, and a `CHAT.md` a cloud
  // service keeps by name only blocks until it downloads.
  const took = Math.round(performance.now() - startedAt);
  if (took >= SLOW_SCAN_MS) {
    console.warn(
      `Chat folders: looked for ${id}'s folder through ${folders.length} CHAT.md files in ${took}ms (${names.size} names recorded on this computer)`,
    );
  }
  return linked.length === 1 ? linked[0] : undefined;
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

function chatLinkedInFileSync(file: string): ChatId | undefined {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, "r");
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
