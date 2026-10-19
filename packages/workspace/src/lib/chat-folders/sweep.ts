import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import {
  CHAT_FILE_NAME,
  CHAT_FOLDER_NAMES,
  CHATS_FOLDER_NAME,
} from "../../constants";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type ChatDir, ChatDirSchema } from "../../schemas/paths";
import { chatFolderTheyOpen } from "../chat/output-folder";
import { foldChatInFolder } from "../records/fold-folder";
import { ensureChatFolder, writeChatFile } from "./chat-folder";
import { chatLinkedInFile } from "./chat-link";
import { chatTitleOf, renderChatMarkdown } from "./chat-markdown";
import { deleteChatFileConflictCopies } from "./conflict-copies";
import {
  chatFolderNames,
  comparable,
  folderLinkedTo,
  recordChatFolderName,
} from "./own-folder";

/**
 * Gives every chat in a workspace its own folder and `CHAT.md`, from the
 * records each holds. Runs at each launch, after the records converter, and
 * costs nothing after the first: a chat whose folder this computer has
 * recorded and whose transcript already reads the same is left alone, so a
 * run over a workspace nothing has changed writes nothing.
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
 * new folder here, and nothing is deleted but a sync engine's copy of a
 * transcript (conflict-copies.ts).
 */

/** What one chat's folder came to. */
export type ChatFolderSweep =
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

export async function sweepChatFolders({
  chatsDir,
  machineDir,
  rootDir,
  timeZone,
  topicNames,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  /** The workspace's machine folder, where each chat's folder name is recorded. */
  machineDir: string;
  /** The workspace's own folder, which `Chats/` is at the top of. */
  rootDir: string;
  /** The zone the days and times in each transcript are written in. */
  timeZone: string;
  /** Each topic's name by its id, for the transcripts' front matter. */
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFoldersSwept> {
  const ids = (await chatIdsIn(chatsDir)).toSorted();
  const names = chatFolderNames(machineDir);
  const adopt = await foldersToAdopt({ ids, names, rootDir });
  const chats = await parallel({ limit: CHATS_AT_ONCE }, ids, async (id) => ({
    id,
    ...(await sweepChatFolder({
      adopt: adopt.get(id),
      chatsDir,
      id,
      machineDir,
      named: names.get(id),
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

/**
 * Moves what the person sent a chat out of its record folder and into the
 * folder they can see, at the launch that gives the chat its folder and at
 * any later launch where the move was refused.
 *
 * Only into a folder the person opens. A workspace kept in the app's own
 * data sits inside the folder the rules close to every command, so moving
 * what the person sent there would leave the agent refused the file they
 * just sent it, with no card to allow it; those keep it in the record
 * folder, which the rules open for reading.
 *
 * Nothing stored has to be rewritten for this. An attachment's path is kept
 * relative, as `attachments/<name>`, so moving the folder the prefix refers
 * to is the whole migration: the records keep saying what they said.
 *
 * Idempotent, and it never merges: a chat whose folder already holds
 * `attachments/` is left alone, so a second run cannot overwrite a file the
 * person put there themselves.
 */
async function moveAttachmentsIn(
  recordDir: ChatDir,
  folderPath: string,
): Promise<void> {
  if (chatFolderTheyOpen(folderPath) === undefined) {
    return;
  }
  const from = path.join(recordDir, CHAT_FOLDER_NAMES.attachments);
  const to = path.join(folderPath, CHAT_FOLDER_NAMES.attachments);
  try {
    if ((await fs.readdir(from)).length === 0) {
      return;
    }
  } catch {
    // Nothing sent to this chat, which is most of them.
    return;
  }
  try {
    await fs.rename(from, to);
  } catch {
    // Already there, or the move crosses a volume, or something holds it.
    // The files stay where they are and still resolve, since the chat's
    // record folder is where an attachment was always read from before.
  }
}

/**
 * Gives one chat its folder and `CHAT.md`, as the launch sweep does for
 * every chat, for a caller that already knows which chat moved.
 *
 * The chat's own turn ending is that caller: the transcript on disk is a
 * relaunch out of date otherwise. A chat whose recorded folder is gone takes
 * the one folder no other chat claims whose `CHAT.md` names it, before a
 * fresh one is made, so a folder renamed in a file manager while the app
 * runs keeps the chat's work in one place. Nothing is written when the
 * bytes already read the same.
 */
export async function writeChatFolder({
  chatsDir,
  id,
  machineDir,
  rootDir,
  timeZone,
  topicNames,
}: {
  chatsDir: string;
  id: ChatId;
  machineDir: string;
  rootDir: string;
  timeZone: string;
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFolderSweep> {
  const names = chatFolderNames(machineDir);
  const named = names.get(id);
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const there = named !== undefined && (await isDir(path.join(chats, named)));
  return sweepChatFolder({
    adopt: there ? undefined : folderLinkedTo(chats, id, names),
    chatsDir,
    id,
    machineDir,
    named,
    rootDir,
    timeZone,
    topicNames,
  });
}

/** Gives one chat its folder and `CHAT.md`. */
async function sweepChatFolder({
  adopt,
  chatsDir,
  id,
  machineDir,
  named,
  rootDir,
  timeZone,
  topicNames,
}: {
  /** The folder under `Chats/` this chat is to take as its own, if any. */
  adopt: string | undefined;
  chatsDir: string;
  id: ChatId;
  machineDir: string;
  /** The name this computer last recorded for the chat's folder. */
  named: string | undefined;
  rootDir: string;
  timeZone: string;
  topicNames?: ReadonlyMap<string, string>;
}): Promise<ChatFolderSweep> {
  try {
    const dir = chatDirOf(chatsDir, id);
    const chat = await foldChatInFolder(dir);
    const markdown = renderChatMarkdown({
      chat,
      id,
      rootDir,
      timeZone,
      topicNames,
    });
    if (markdown === undefined) {
      return { kind: "no-conversation" };
    }
    const folder = await ensureChatFolder({
      folder: adopt ?? named,
      rootDir,
      title: chatTitleOf(chat),
    });
    await moveAttachmentsIn(dir, folder.path);
    // Before the transcript is compared, not after: a run that writes
    // nothing is most of them, and a copy left beside the file we are not
    // rewriting is exactly the one nothing else would ever notice.
    await deleteChatFileConflictCopies({ folder: folder.path, id });
    if (named === folder.name && (await alreadyReads(folder.path, markdown))) {
      return { kind: "already-there" };
    }
    await writeChatFile(folder.path, markdown);
    if (named !== folder.name) {
      await recordChatFolderName(machineDir, id, folder.name);
    }
    return { folder: folder.name, kind: "written" };
  } catch (error) {
    return { error: String(error), kind: "failed" };
  }
}

/**
 * Which chats are to take a folder a person renamed in a file manager, by the
 * name the folder has now: a chat whose recorded folder is gone, or that this
 * computer has recorded none for, and for which exactly one folder under
 * `Chats/` that no chat claims names it.
 *
 * Both halves have to hold, and neither is read as an answer on its own:
 *
 * - Two unclaimed folders naming one chat are a copy, the conflicted copy a
 *   sync engine left, or a restore from a backup, and which of them the chat
 *   belongs in is the person's to say.
 * - A chat whose own folder is still there is the one that was copied, and the
 *   copy is the person's: a second folder holding the same transcript is not a
 *   rename.
 * - A folder with no `CHAT.md`, one whose head names no chat, or one naming a
 *   chat this workspace does not have says nothing about a chat here.
 *
 * A chat this computer has recorded no folder for is one whose folder another
 * computer made, so it is found the same way.
 *
 * Costs the listing of `Chats/`, and the head of one `CHAT.md` per folder no
 * chat claims. A workspace where nothing was renamed opens no transcript:
 * that no chat has lost its folder is answered from the listing alone.
 */
async function foldersToAdopt({
  ids,
  names,
  rootDir,
}: {
  ids: readonly ChatId[];
  names: ReadonlyMap<string, string>;
  rootDir: string;
}): Promise<ReadonlyMap<ChatId, string>> {
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const listed = await foldersIn(chats);
  if (listed.length === 0) {
    return new Map();
  }
  const there = new Set(listed.map(comparable));
  const claimed = new Set([...names.values()].map(comparable));
  const lost = new Set(
    ids.filter((id) => {
      const name = names.get(id);
      return name === undefined || !there.has(comparable(name));
    }),
  );
  const unclaimed = listed.filter((name) => !claimed.has(comparable(name)));
  if (lost.size === 0 || unclaimed.length === 0) {
    return new Map();
  }
  const named = await parallel(
    { limit: FOLDERS_AT_ONCE },
    unclaimed,
    async (name) => ({
      id: await chatLinkedInFile(path.join(chats, name, CHAT_FILE_NAME)),
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

/** Where a chat's records are, `chats/<id>/`. */
function chatDirOf(chatsDir: string, id: ChatId): ChatDir {
  return ChatDirSchema.parse(path.join(chatsDir, id));
}

async function isDir(entry: string): Promise<boolean> {
  try {
    return (await fs.stat(entry)).isDirectory();
  } catch {
    return false;
  }
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
