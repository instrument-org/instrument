import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import { CHAT_FILE_NAME } from "../../constants";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { ChatDirSchema } from "../../schemas/paths";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { foldChatInFolder } from "../records/fold-folder";
import { ensureChatFolder, writeChatFile } from "./chat-folder";
import { chatTitleOf, renderChatMarkdown } from "./chat-markdown";

/**
 * Gives every chat in a workspace its own folder and `CHAT.md`, from the
 * records each holds. Runs at each launch, after the records converter, and
 * costs nothing after the first: a chat whose folder its settings name and
 * whose transcript already reads the same is left alone, so a run over a
 * workspace nothing has changed writes nothing.
 *
 * Reads the chats' records straight from their folders rather than through
 * the records service, so it can run before the workspace is up, and over a
 * copy of one nothing has open: a script, a test, the clone of a real install
 * this was checked on.
 *
 * Files the chats already made stay where they are. Nothing is moved into the
 * new folder here.
 */

/** What one chat's folder came to. */
type ChatFolderSweep =
  /** The folder and the file are as they should be; nothing was written. */
  | { kind: "already-there" }
  | { error: string; kind: "failed" }
  /** Its records name no conversation of the chat's own: nothing to write. */
  | { kind: "no-conversation" }
  | { folder: string; kind: "written" };

export interface ChatFoldersSwept {
  chats: ({ id: ChatId } & ChatFolderSweep)[];
  /** Whether every chat that holds a conversation has its folder and file. */
  complete: boolean;
  counts: Record<ChatFolderSweep["kind"], number>;
}

/**
 * How many chats are rendered at once. Each is a read of a folder, a fold and
 * one write, so the limit is there to keep a workspace of hundreds of chats
 * from opening hundreds of handles rather than for the speed.
 */
const CHATS_AT_ONCE = 8;

export async function sweepChatFolders({
  chatsDir,
  rootDir,
  timeZone,
  topicNames,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  /** The workspace's own folder, which `Chats/` is at the top of. */
  rootDir: string;
  /** The zone the days and times in each transcript are written in. */
  timeZone: string;
  /** Each topic's name by its id, for the transcripts' front matter. */
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFoldersSwept> {
  const ids = (await chatIdsIn(chatsDir)).toSorted();
  const chats = await parallel({ limit: CHATS_AT_ONCE }, ids, async (id) => ({
    id,
    ...(await sweepChatFolder({ chatsDir, id, rootDir, timeZone, topicNames })),
  }));
  const counts: ChatFoldersSwept["counts"] = {
    "already-there": 0,
    failed: 0,
    "no-conversation": 0,
    written: 0,
  };
  for (const chat of chats) {
    counts[chat.kind] += 1;
  }
  return { chats, complete: counts.failed === 0, counts };
}

/** Gives one chat its folder and `CHAT.md`. */
async function sweepChatFolder({
  chatsDir,
  id,
  rootDir,
  timeZone,
  topicNames,
}: {
  chatsDir: string;
  id: ChatId;
  rootDir: string;
  timeZone: string;
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFolderSweep> {
  try {
    const dir = ChatDirSchema.parse(path.join(chatsDir, id));
    const chat = await foldChatInFolder(dir);
    const markdown = renderChatMarkdown({ chat, id, timeZone, topicNames });
    if (markdown === undefined) {
      return { kind: "no-conversation" };
    }
    const record = await readChatRecord(dir);
    const folder = await ensureChatFolder({
      folder: record.settings?.folder,
      rootDir,
      title: chatTitleOf(chat),
    });
    if (
      record.settings?.folder === folder.name &&
      (await alreadyReads(folder.path, markdown))
    ) {
      return { kind: "already-there" };
    }
    await writeChatFile(folder.path, markdown);
    if (record.settings?.folder !== folder.name && !record.unreadable) {
      await updateChatRecord(dir, "settings", (current) => ({
        ...current.raw,
        folder: folder.name,
      }));
    }
    return { folder: folder.name, kind: "written" };
  } catch (error) {
    return { error: String(error), kind: "failed" };
  }
}

/** Whether the folder's `CHAT.md` is already these bytes. */
async function alreadyReads(
  folder: string,
  markdown: string,
): Promise<boolean> {
  try {
    return (
      (await fs.readFile(path.join(folder, CHAT_FILE_NAME), "utf8")) ===
      markdown
    );
  } catch {
    return false;
  }
}

/** Every chat the workspace's record folders hold, by id. */
async function chatIdsIn(chatsDir: string): Promise<ChatId[]> {
  let entries;
  try {
    entries = await fs.readdir(chatsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      return [];
    }
    const id = ChatIdSchema.safeParse(entry.name);
    return id.success ? [id.data] : [];
  });
}
