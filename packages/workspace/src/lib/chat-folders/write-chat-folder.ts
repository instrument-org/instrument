import fs from "node:fs/promises";
import path from "node:path";

import {
  CHAT_FILE_NAME,
  CHAT_FOLDER_NAMES,
  CHATS_FOLDER_NAME,
} from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { type ChatDir, ChatDirSchema } from "../../schemas/paths";
import { chatFolderTheyOpen } from "../chat/output-folder";
import { readTopicsSync } from "../chat/topics";
import { createWriteQueue } from "../create-write-queue";
import { foldChatInFolder } from "../records/fold-folder";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { ensureChatFolder, writeChatFile } from "./chat-folder";
import { chatTitleOf, renderChatMarkdown } from "./chat-markdown";
import { deleteChatFileConflictCopies } from "./conflict-copies";
import {
  chatFolderNames,
  folderLinkedTo,
  recordChatFolderName,
} from "./own-folder";

/**
 * Writes a chat's folder and its `CHAT.md` from the records the chat holds.
 *
 * `CHAT.md` is a convenience copy of the conversation, so it is written at
 * the ends of things rather than kept current: when a turn ends
 * (`on-turn-end.ts`), when the person sends a message, when a title settles
 * (`follow-title.ts`), and once for each chat a launch migration gives a
 * folder (`first-folders.ts`). Nothing reads every chat to check its
 * transcript; one a moment out of date is fine.
 *
 * Where a person renamed a chat's folder in a file manager, the chat takes
 * the name they gave it before anything is written, so its transcript goes
 * back where they put it (`folderLinkedTo`).
 *
 * Files the chat already made stay where they are. Nothing is deleted but a
 * sync engine's copy of the transcript (conflict-copies.ts).
 */

/** What one chat's folder came to. */
export type ChatFolderWrite =
  /** The folder and the file are as they should be; nothing was written. */
  | { kind: "already-there" }
  | { error: string; kind: "failed" }
  /** Its records name no conversation of the chat's own: nothing to write. */
  | { kind: "no-conversation" }
  | { folder: string; kind: "written" };

/**
 * One write per chat at a time: a turn ending, a message sent and a title
 * settling can land together, and two writes of one folder would race to
 * claim it and to rename the same temp file over `CHAT.md`.
 */
const writesInOrder = createWriteQueue();

/**
 * Writes the chat's folder and `CHAT.md` from its records as they stand now,
 * in the running workspace, reporting a failure rather than throwing it.
 *
 * The renderer needs the topics by name and a zone to write the days in,
 * both read here rather than held, so a topic renamed since shows under its
 * new name.
 */
export function rewriteChatFolder(id: ChatId): Promise<void> {
  return writesInOrder(id, async () => {
    const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
    const written = await writeChatFolder({
      chatsDir: workspaceLayout(rootDir).chatsDir,
      id,
      machineDir: workspaceMachineDir,
      rootDir,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      topicNames: new Map(
        readTopicsSync(rootDir).map((topic) => [topic.id, topic.name]),
      ),
    });
    if (written.kind === "failed") {
      getWorkspaceConfig().captureException(
        new Error("Could not write a chat's transcript"),
        { chatId: id, data: { error: written.error } },
      );
    }
  });
}

/**
 * Moves what the person sent a chat out of its record folder and into the
 * folder they can see, the first time the chat's folder is written and at
 * any later write where the move was refused.
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
 * Gives one chat its folder and `CHAT.md`.
 *
 * A chat whose recorded folder is gone takes the one folder no other chat
 * claims whose `CHAT.md` names it, before a fresh one is made, so a folder
 * renamed in a file manager keeps the chat's work in one place. Nothing is
 * written when the bytes already read the same.
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
}): Promise<ChatFolderWrite> {
  const names = chatFolderNames(machineDir);
  const named = names.get(id);
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const there = named !== undefined && (await isDir(path.join(chats, named)));
  return writeFolder({
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
async function writeFolder({
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
}): Promise<ChatFolderWrite> {
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
