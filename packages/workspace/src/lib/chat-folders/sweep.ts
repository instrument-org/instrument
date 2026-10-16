import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type ChatDir, ChatDirSchema } from "../../schemas/paths";
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
 * Where a person renamed a chat's folder in a file manager, the chat takes
 * the name they gave it before anything is written, so its transcript goes
 * back where they put it. {@link foldersToAdopt} says what has to hold first.
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

/**
 * How many folders under `Chats/` are read at once for the chat each names.
 * None or one on a normal launch; a restore from a backup is what makes it
 * many.
 */
const FOLDERS_AT_ONCE = 8;

/** How much of a `CHAT.md` is read to find the chat it links to. */
const LINK_HEAD_BYTES = 2048;

/** The link to a chat, as `CHAT.md` writes it under the front matter. */
const CHAT_LINK = new RegExp(`${APP_NAME_SLUG}://chat/([^)\\s]+)`);

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
  const adopt = await foldersToAdopt({ chatsDir, ids, rootDir });
  const chats = await parallel({ limit: CHATS_AT_ONCE }, ids, async (id) => ({
    id,
    ...(await sweepChatFolder({
      adopt: adopt.get(id),
      chatsDir,
      id,
      rootDir,
      timeZone,
      topicNames,
    })),
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
  adopt,
  chatsDir,
  id,
  rootDir,
  timeZone,
  topicNames,
}: {
  /** The folder under `Chats/` this chat is to take as its own, if any. */
  adopt: string | undefined;
  chatsDir: string;
  id: ChatId;
  rootDir: string;
  timeZone: string;
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFolderSweep> {
  try {
    const dir = chatDirOf(chatsDir, id);
    const chat = await foldChatInFolder(dir);
    const markdown = renderChatMarkdown({ chat, id, timeZone, topicNames });
    if (markdown === undefined) {
      return { kind: "no-conversation" };
    }
    const record = await readChatRecord(dir);
    const folder = await ensureChatFolder({
      folder: adopt ?? record.settings?.folder,
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

/**
 * Which chats are to take a folder a person renamed in a file manager, by the
 * name the folder has now: a chat whose own folder is gone, and for which
 * exactly one folder under `Chats/` that no chat claims links to it.
 *
 * Both halves have to hold, and neither is read as an answer on its own:
 *
 * - Two unclaimed folders linking to one chat are a copy, the conflicted copy
 *   a sync engine left, or a restore from a backup, and which of them the chat
 *   belongs in is the person's to say.
 * - A chat whose own folder is still there is the one that was copied, and the
 *   copy is the person's: a second folder holding the same transcript is not a
 *   rename.
 * - A folder with no `CHAT.md`, one whose head holds no link, or one linking
 *   to a chat this workspace does not have says nothing about a chat here.
 *
 * Costs the listing of `Chats/` and each chat's settings, which is what says
 * who claims which name, and the head of one `CHAT.md` per folder no chat
 * claims. A workspace where nothing was renamed opens no transcript: that no
 * chat has lost its folder is answered from the listing alone.
 */
async function foldersToAdopt({
  chatsDir,
  ids,
  rootDir,
}: {
  chatsDir: string;
  ids: readonly ChatId[];
  rootDir: string;
}): Promise<ReadonlyMap<ChatId, string>> {
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const listed = await foldersIn(chats);
  if (listed.length === 0) {
    return new Map();
  }
  const claims = await parallel({ limit: CHATS_AT_ONCE }, ids, async (id) => ({
    folder: (await readChatRecord(chatDirOf(chatsDir, id))).settings?.folder,
    id,
  }));
  const there = new Set(listed.map(comparable));
  const claimed = new Set(
    claims.flatMap(({ folder }) =>
      folder === undefined ? [] : [comparable(folder)],
    ),
  );
  const lost = new Set(
    claims.flatMap(({ folder, id }) =>
      folder !== undefined && !there.has(comparable(folder)) ? [id] : [],
    ),
  );
  const unclaimed = listed.filter((name) => !claimed.has(comparable(name)));
  if (lost.size === 0 || unclaimed.length === 0) {
    return new Map();
  }
  const named = await parallel(
    { limit: FOLDERS_AT_ONCE },
    unclaimed,
    async (name) => ({
      id: await chatLinkedFrom(path.join(chats, name)),
      name,
    }),
  );
  const folders = new Map<ChatId, string[]>();
  for (const { id, name } of named) {
    if (id === undefined || !lost.has(id)) {
      continue;
    }
    folders.set(id, [...(folders.get(id) ?? []), name]);
  }
  return new Map(
    [...folders].flatMap(([id, [first, ...rest]]) =>
      first !== undefined && rest.length === 0 ? [[id, first] as const] : [],
    ),
  );
}

/**
 * The chat a folder's `CHAT.md` links to, from the head of the file: the
 * front matter and the line under it, however the rest of the transcript
 * reads.
 */
async function chatLinkedFrom(folder: string): Promise<ChatId | undefined> {
  let head: string;
  try {
    const handle = await fs.open(path.join(folder, CHAT_FILE_NAME), "r");
    try {
      const read = await handle.read({
        buffer: Buffer.alloc(LINK_HEAD_BYTES),
        position: 0,
      });
      head = read.buffer.toString("utf8", 0, read.bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  const linked = CHAT_LINK.exec(head)?.[1];
  if (linked === undefined) {
    return undefined;
  }
  const id = ChatIdSchema.safeParse(linked);
  return id.success ? id.data : undefined;
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

/**
 * A folder's name as it compares: composed, which is the form a name is
 * written in, so a listing that gives back the decomposed one still matches
 * the name a chat's settings hold.
 */
function comparable(name: string): string {
  return name.normalize("NFC");
}

/** Where a chat's records are, `chats/<id>/`. */
function chatDirOf(chatsDir: string, id: ChatId): ChatDir {
  return ChatDirSchema.parse(path.join(chatsDir, id));
}

/** The folders directly under `Chats/`, as the listing names them. */
async function foldersIn(chats: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(chats, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) =>
    entry.isDirectory() && !entry.name.startsWith(".") ? [entry.name] : [],
  );
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
