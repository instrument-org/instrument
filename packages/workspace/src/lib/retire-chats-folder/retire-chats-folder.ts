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
import { chatLinkedInFile } from "./chat-link";
import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "./chat-transcript";
import { deleteChatFileConflictCopies } from "./conflict-copies";
import { type ChatFolderMove, recordChatFolderMoves } from "./folder-moves";

/**
 * Empties the `Chats/` folder earlier builds kept at the workspace's top
 * level, one folder per chat, into the places this build keeps those
 * things:
 *
 * - `CHAT.md`, the transcript the app wrote, and every sync engine's copy of
 *   it are deleted: the chat's records say everything they did.
 * - What the person sent (`attachments/`) and the chat's handoff notes go
 *   back into the chat's records, `.instrument/chats/<id>/`. A name the
 *   records already have stays behind and moves on with the rest.
 * - Whatever else is there, the work the agent kept, goes to
 *   `Files/<same name>/`, merged into a folder of that name already there,
 *   where a file whose name is taken gets a numbered one (`notes 2.md`).
 * - The emptied folders go, `Chats/` once it is empty, and the machine file
 *   that named each chat's folder on this computer.
 *
 * Each move is a rename, so a file a cloud service keeps by name only moves
 * without downloading, and nothing's contents are read but the head of a
 * `CHAT.md` here on disk, which names the chat it was for. Where to go next
 * is in a synced record (`folder-moves.ts`), so a path in an older chat's
 * messages opens where its file is now. Idempotent: a launch after the one
 * that emptied `Chats/` finds nothing to do, and one interrupted partway
 * carries on.
 */

/** What emptying `Chats/` did. */
export interface ChatsFolderRetired {
  /** Folders that held nothing but the transcript, deleted. */
  deleted: number;
  /** What could not be moved, for the log; the next launch tries again. */
  left: { reason: string; where: string }[];
  /** Folders moved into `Files/`. */
  moved: number;
  /** Attachments and handoff notes put back in their chats' records. */
  returned: number;
}

export async function retireChatsFolder({
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
}): Promise<ChatsFolderRetired> {
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  const done: ChatsFolderRetired = {
    deleted: 0,
    left: [],
    moved: 0,
    returned: 0,
  };
  const namesFile = path.join(
    machineDir,
    WORKSPACE_MACHINE_ENTRIES.chatFolders,
  );
  const entries = await entriesIn(chats);
  if (entries === undefined) {
    await fs.rm(namesFile, { force: true });
    return done;
  }
  const owners = chatsByFolderName(namesFile);
  const layout = workspaceLayout(rootDir);
  const moves: ChatFolderMove[] = [];
  try {
    for (const entry of entries) {
      const from = path.join(chats, entry.name);
      if (isFileManagerRecord(entry.name)) {
        continue;
      }
      if (!entry.isDirectory()) {
        // A file of the person's left loose in `Chats/`.
        await moveInto(from, filesDir, done);
        continue;
      }
      const chat =
        (await chatLinkedInFile(path.join(from, CHAT_FILE_NAME))) ??
        owners.get(entry.name.normalize("NFC"));
      await fs.rm(path.join(from, CHAT_FILE_NAME), { force: true });
      // What an interrupted write of the transcript left.
      await fs.rm(path.join(from, `.~${CHAT_FILE_NAME}.tmp`), { force: true });
      await deleteChatFileConflictCopies(from);
      if (chat !== undefined) {
        const records = path.join(layout.chatsDir, chat);
        if (await isDir(records)) {
          done.returned += await returnToRecords(from, records);
        }
      }
      if (removeFolderLeftEmpty(from)) {
        done.deleted += 1;
        continue;
      }
      const to = path.join(filesDir, entry.name);
      if (await moveFolder(from, to, done)) {
        done.moved += 1;
        moves.push({
          ...(chat !== undefined && { chat }),
          from: entry.name,
          to: entry.name,
        });
      }
    }
  } finally {
    await recordChatFolderMoves({
      device,
      devicesDir: layout.devicesDir,
      moves,
    });
  }
  if (removeFolderLeftEmpty(chats)) {
    await fs.rm(namesFile, { force: true });
  }
  return done;
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

/**
 * Moves a folder to `to`: whole, by one rename, where nothing is there yet,
 * and otherwise entry by entry into the folder there. Answers whether
 * anything moved.
 */
async function moveFolder(
  from: string,
  to: string,
  done: ChatsFolderRetired,
): Promise<boolean> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (!(await exists(to))) {
    try {
      await fs.rename(from, to);
      return true;
    } catch (error) {
      done.left.push({ reason: String(error), where: from });
      return false;
    }
  }
  if (!(await isDir(to))) {
    // A file holds the name: the folder takes a numbered one beside it.
    return renamedOrLeft(from, await freeName(to, true), done);
  }
  let moved = false;
  for (const entry of (await entriesIn(from)) ?? []) {
    const each = path.join(from, entry.name);
    const there = path.join(to, entry.name);
    if (isFileManagerRecord(entry.name) && (await exists(there))) {
      continue;
    }
    if (entry.isDirectory() && (await isDir(there))) {
      moved = (await moveFolder(each, there, done)) || moved;
    } else {
      moved =
        (await renamedOrLeft(
          each,
          (await exists(there))
            ? await freeName(there, entry.isDirectory())
            : there,
          done,
        )) || moved;
    }
  }
  removeFolderLeftEmpty(from);
  return moved;
}

/** Moves a loose file into `dir`, under a numbered name where its own is taken. */
async function moveInto(
  file: string,
  dir: string,
  done: ChatsFolderRetired,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const there = path.join(dir, path.basename(file));
  await renamedOrLeft(
    file,
    (await exists(there)) ? await freeName(there, false) : there,
    done,
  );
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

async function renamedOrLeft(
  from: string,
  to: string,
  done: ChatsFolderRetired,
): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    done.left.push({ reason: String(error), where: from });
    return false;
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
