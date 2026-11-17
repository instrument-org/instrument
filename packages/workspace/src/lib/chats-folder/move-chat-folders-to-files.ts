import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES, HANDOFF_NOTES_FILE_NAME } from "../../constants";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type DeviceId } from "../records/device-id";
import { readJsonRecordSync } from "../json-record-file";
import { isFileManagerRecord, removeFolderLeftEmpty } from "../system-clutter";
import { workspaceLayout } from "../workspace-layout";
import { type ChatLink, chatLinkedInFile, readChatLink } from "./chat-link";
import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "./chat-transcript";
import {
  deleteChatFileConflictCopies,
  isChatFileConflictCopy,
} from "./conflict-copies";
import {
  type ChatFolderMovesWriter,
  openChatFolderMoves,
} from "./folder-moves";

/**
 * Empties the `Chats/` folder earlier builds kept at the workspace's top
 * level, one folder per chat, into the places this build keeps those
 * things. Only a folder that is surely a chat's is touched: its `CHAT.md`
 * names the chat, or this computer's names file (`chat-folders.json`) says
 * the chat's folder had that name. Anything else under `Chats/` is the
 * person's and stays, and a `Chats/` where no folder is a chat's is left
 * whole. A folder whose `CHAT.md` cannot be read (kept by name only, or held
 * by another program) waits for a later launch. For a chat's folder:
 *
 * - What the person sent (`attachments/`) and the chat's handoff notes go
 *   back into the chat's records, `.instrument/chats/<id>/`. A name the
 *   records already have stays behind and moves on with the rest.
 * - Whatever else is there, the work the agent kept, goes to
 *   `Files/<same name>/`, or `Files/<name> 2/` where that name is taken, by
 *   one rename of the whole folder.
 * - Then `CHAT.md`, the transcript the app wrote, and every sync engine's
 *   copy of it are deleted: the chat's records say everything they did.
 *   Where the chat's records are gone (the chat was deleted and its folder
 *   kept), the transcript is all that is left of it and stays with the rest.
 * - The emptied folders go, `Chats/` once it is empty, and the machine file
 *   that named each chat's folder on this computer.
 *
 * Each move is a rename, so a file a cloud service keeps by name only moves
 * without downloading, and nothing's contents are read but the head of a
 * `CHAT.md` here on disk, which names the chat it was for. Where each folder
 * went is recorded before it moves, in a synced record (`folder-moves.ts`),
 * so a path in an older chat's messages opens where its file is now.
 * Idempotent: a launch after the one that emptied `Chats/` finds nothing to
 * do, and one interrupted partway carries on.
 */

const TRANSCRIPT_TEMP_NAME = `.~${CHAT_FILE_NAME}.tmp`;

/** What emptying `Chats/` did. */
export interface ChatFoldersMoved {
  /** Folders that held nothing but the transcript, deleted. */
  deleted: number;
  /** What could not be moved, for the log; the next launch tries again. */
  left: { reason: string; where: string }[];
  /** Folders moved into `Files/`. */
  moved: number;
  /** Attachments and handoff notes put back in their chats' records. */
  returned: number;
}

export async function moveChatFoldersToFiles({
  device,
  filesDir,
  machineDir,
  rootDir,
}: {
  /** This computer, which writes its own file of the moves record. */
  device: DeviceId;
  /** Where kept work goes: the output folder's `Files/`. */
  filesDir: string;
  machineDir: string;
  rootDir: string;
}): Promise<ChatFoldersMoved> {
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const done: ChatFoldersMoved = {
    deleted: 0,
    left: [],
    moved: 0,
    returned: 0,
  };
  const namesFile = path.join(
    machineDir,
    WORKSPACE_MACHINE_ENTRIES.chatFolders,
  );
  const listed = await listChatsFolder(chats);
  if (listed.kind === "absent") {
    await fs.rm(namesFile, { force: true });
    return done;
  }
  if (listed.kind === "unreadable") {
    // The names file is the only clue to a folder whose transcript cannot
    // be read, so it stays until `Chats/` is gone.
    done.left.push({ reason: listed.reason, where: chats });
    return done;
  }
  const owners = chatsByFolderName(namesFile);
  const folders: { chat: ChatId; link: ChatLink; name: string }[] = [];
  const loose: string[] = [];
  for (const entry of listed.entries) {
    if (isFileManagerRecord(entry.name)) {
      continue;
    }
    if (!entry.isDirectory()) {
      loose.push(entry.name);
      continue;
    }
    const link = await readChatLink(
      path.join(chats, entry.name, CHAT_FILE_NAME),
    );
    if (link.kind === "unreadable") {
      done.left.push({
        reason: `its ${CHAT_FILE_NAME} could not be read (${link.reason})`,
        where: path.join(chats, entry.name),
      });
      continue;
    }
    const chat =
      link.kind === "chat"
        ? link.chat
        : owners.get(entry.name.normalize("NFC"));
    if (chat !== undefined) {
      folders.push({ chat, link, name: entry.name });
    }
  }
  if (folders.length === 0) {
    // Not a folder the app made, or nothing in it is sure to be a chat's yet.
    return done;
  }
  const layout = workspaceLayout(rootDir);
  let store: Promise<ChatFolderMovesWriter> | undefined;
  const openStore = () =>
    (store ??= openChatFolderMoves({ device, devicesDir: layout.devicesDir }));
  try {
    for (const name of loose) {
      await moveInto(path.join(chats, name), filesDir, done);
    }
    for (const folder of folders) {
      try {
        await moveChatFolder({
          chats,
          done,
          filesDir,
          folder,
          openStore,
          recordsDir: path.join(layout.chatsDir, folder.chat),
        });
      } catch (error) {
        // One folder another program holds leaves the rest to go on.
        done.left.push({
          reason: String(error),
          where: path.join(chats, folder.name),
        });
      }
    }
  } finally {
    (await store?.catch(() => undefined))?.close();
  }
  if (removeFolderLeftEmpty(chats)) {
    await fs.rm(namesFile, { force: true });
  }
  return done;
}

/**
 * Empties one chat's folder. The transcript goes only once what goes back
 * into the records has and the folder has moved, so a launch cut short, or a
 * move another program holds up, still finds the chat named next time.
 */
async function moveChatFolder({
  chats,
  done,
  filesDir,
  folder: { chat, link, name },
  openStore,
  recordsDir,
}: {
  chats: string;
  done: ChatFoldersMoved;
  filesDir: string;
  folder: { chat: ChatId; link: ChatLink; name: string };
  openStore: () => Promise<ChatFolderMovesWriter>;
  recordsDir: string;
}): Promise<void> {
  const from = path.join(chats, name);
  // Where the chat's records are gone, its transcript is all that is left
  // of it, and stays with the rest.
  const recorded = await isDir(recordsDir);
  if (recorded) {
    done.returned += await returnToRecords(from, recordsDir);
    if (await holdsOnlyTranscripts(from, link)) {
      await deleteTranscripts(from, link);
      if (removeFolderLeftEmpty(from)) {
        done.deleted += 1;
      }
      return;
    }
  }
  if (removeFolderLeftEmpty(from)) {
    done.deleted += 1;
    return;
  }
  const taken = path.join(filesDir, name);
  const to = (await exists(taken)) ? await freeName(taken, true) : taken;
  const store = await openStore();
  // Recorded first, so a launch cut short after the rename still maps old
  // paths to where the folder went.
  await store.record([{ chat, from: name, to: path.basename(to) }]);
  await fs.mkdir(filesDir, { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    await store.forget(name);
    done.left.push({ reason: String(error), where: from });
    return;
  }
  done.moved += 1;
  if (recorded) {
    await deleteTranscripts(to, link);
  }
}

/** Deletes the transcript the app wrote in a chat's folder, and what was left of it. */
async function deleteTranscripts(folder: string, link: ChatLink) {
  if (link.kind === "chat") {
    await fs.rm(path.join(folder, CHAT_FILE_NAME), { force: true });
  }
  // What an interrupted write of the transcript left.
  await fs.rm(path.join(folder, TRANSCRIPT_TEMP_NAME), { force: true });
  await deleteChatFileConflictCopies(folder);
}

/** Whether a chat's folder has nothing but its transcripts and the system's clutter. */
async function holdsOnlyTranscripts(
  folder: string,
  link: ChatLink,
): Promise<boolean> {
  for (const entry of (await entriesIn(folder)) ?? []) {
    const transcript =
      (entry.name === CHAT_FILE_NAME && link.kind === "chat") ||
      entry.name === TRANSCRIPT_TEMP_NAME ||
      (entry.isFile() &&
        isChatFileConflictCopy(entry.name) &&
        (await chatLinkedInFile(path.join(folder, entry.name))) !== undefined);
    if (!transcript && !isFileManagerRecord(entry.name)) {
      return false;
    }
  }
  return true;
}

/**
 * Puts what the person sent and the chat's handoff notes back in its
 * records, answering how many entries went. A name already there stays.
 */
async function returnToRecords(from: string, records: string): Promise<number> {
  let returned = 0;
  const sent = path.join(from, CHAT_FOLDER_NAMES.attachments);
  const into = path.join(records, CHAT_FOLDER_NAMES.attachments);
  for (const entry of (await entriesIn(sent)) ?? []) {
    if (isFileManagerRecord(entry.name)) {
      continue;
    }
    const target = path.join(into, entry.name);
    if (await exists(target)) {
      continue;
    }
    await fs.mkdir(into, { recursive: true });
    if (await renamed(path.join(sent, entry.name), target)) {
      returned += 1;
    }
  }
  removeFolderLeftEmpty(sent);
  const notes = path.join(from, HANDOFF_NOTES_FILE_NAME);
  const notesTo = path.join(records, HANDOFF_NOTES_FILE_NAME);
  if ((await exists(notes)) && !(await exists(notesTo))) {
    if (await renamed(notes, notesTo)) {
      returned += 1;
    }
  }
  return returned;
}

/** Moves a loose file into `dir`, under a numbered name where its own is taken. */
async function moveInto(
  file: string,
  dir: string,
  done: ChatFoldersMoved,
): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const there = path.join(dir, path.basename(file));
    await fs.rename(
      file,
      (await exists(there)) ? await freeName(there, false) : there,
    );
  } catch (error) {
    done.left.push({ reason: String(error), where: file });
  }
}

/**
 * The first numbered name beside `taken` that nothing holds, the way the
 * Finder numbers a copy: `notes 2.md`, then `notes 3.md`; a folder's whole
 * name is numbered, since a dot in it is no extension.
 */
async function freeName(taken: string, isFolder: boolean): Promise<string> {
  const dir = path.dirname(taken);
  const name = path.basename(taken);
  const extension = isFolder ? "" : path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = path.join(dir, `${stem} ${suffix}${extension}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}

async function renamed(from: string, to: string): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch {
    // Something holds it: it stays, and moves on with the rest.
    return false;
  }
}

/** Each chat by the name this computer recorded for its folder. */
function chatsByFolderName(namesFile: string): Map<string, ChatId> {
  // oxlint-disable-next-line studio/no-sync-content-read -- the names file is in the machine folder, on local disk.
  const read = readJsonRecordSync(namesFile);
  if (read.kind !== "read") {
    return new Map();
  }
  return new Map(
    Object.entries(read.record).flatMap(([id, name]) => {
      const chat = ChatIdSchema.safeParse(id);
      return chat.success && typeof name === "string" && name !== ""
        ? [[name.normalize("NFC"), chat.data] as const]
        : [];
    }),
  );
}

async function listChatsFolder(
  dir: string,
): Promise<
  | { entries: Dirent[]; kind: "listed" }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string }
> {
  try {
    return {
      entries: await fs.readdir(dir, { withFileTypes: true }),
      kind: "listed",
    };
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable", reason: String(error) };
  }
}

async function entriesIn(dir: string): Promise<Dirent[] | undefined> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

async function exists(entry: string): Promise<boolean> {
  try {
    await fs.lstat(entry);
    return true;
  } catch {
    return false;
  }
}

async function isDir(entry: string): Promise<boolean> {
  try {
    return (await fs.stat(entry)).isDirectory();
  } catch {
    return false;
  }
}
