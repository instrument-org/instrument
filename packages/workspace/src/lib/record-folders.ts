import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs";
import path from "node:path";

import { CHATS_DIR_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import {
  type AbsolutePath,
  type ChatDir,
  ChatDirSchema,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { WINDOW_ID } from "../schemas/window-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { windowDir } from "./window-paths";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What a record is, which is where its folder is: a folder under `chats/` is
 * a chat. A chat's tasks are sessions in its store rather than records, and a
 * `tasks/` folder an earlier version left inside a chat is nobody's record. A
 * task record is what a test places (`placeTaskAt`).
 */
export type RecordRef =
  | { chatId: ChatId; id: TaskId; kind: "task" }
  | { id: ChatId; kind: "chat" };

/**
 * Where every record is, for the workspace it was read from. A chat's folder
 * has a readable name of its own, so which session it holds is read from its
 * settings. The index is read from disk the first time a workspace asks, and
 * kept current by whatever makes or trashes a record. An id it does not know
 * is looked for on disk where a chat would be before it is called not found,
 * so a folder made behind its back is found; one
 * moved behind its back (the layout migration) calls `forgetRecordFolders`.
 */
interface Index {
  /**
   * Each chat's one session, by any record id, so an id not yet known to be
   * a chat's can be looked up.
   */
  chats: Map<TaskId, { id: ChatId; sessionId: StoreId.Session }>;
  root: string;
  /** Each chat's id, by its session. */
  sessions: Map<StoreId.Session, ChatId>;
}

let index: Index | undefined;

/**
 * The records this process was handed and the folder each is in, in a
 * process that is told its records rather than reading them (the bash
 * worker, handed the one its command runs in). Set, it is the whole answer:
 * an id not in it is not found, and the index is never read from disk.
 */
let handed: Map<TaskId, { dir: TaskDir; ref: RecordRef }> | undefined;

/**
 * Tasks recorded at a folder other than their chat's, which only a test
 * makes (`placeTaskAt`): it keeps its files wherever it likes, under a chat
 * that need not exist on disk. Consulted before the index.
 */
const placedAt = new Map<TaskId, { chatId: ChatId; dir: TaskDir }>();

/** A chat's own folder. */
export function chatDir(id: ChatId): ChatDir {
  return ChatDirSchema.parse(path.join(chatsDir(), id));
}

/** Every chat's id. */
export function chatIds(): ChatId[] {
  return [...read().chats.values()].map((chat) => chat.id);
}

/**
 * The chat a record belongs to: a chat's own id, the chat whose folder holds
 * a task, or none for an id no record has.
 */
export function chatOf(id: TaskId): ChatId | undefined {
  const ref = resolveRecord(id);
  if (ref.isErr()) {
    return undefined;
  }
  return ref.value.kind === "chat" ? ref.value.id : ref.value.chatId;
}

/** A record's id as a chat's, or none for a task's and an id no record has. */
export function resolveChat(id: TaskId): ChatId | undefined {
  const ref = resolveRecord(id);
  return ref.isOk() && ref.value.kind === "chat" ? ref.value.id : undefined;
}

/** The chat a session is, or none for a session that is not a chat's. */
export function chatOfSession(sessionId: StoreId.Session): ChatId | undefined {
  return read().sessions.get(sessionId);
}

/** The folder every chat is in. */
export function chatsDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, CHATS_DIR_NAME);
}

/** The folder a resolved record lives in. */
export function dirOf(ref: RecordRef): TaskDir {
  if (ref.kind === "chat") {
    return chatDir(ref.id);
  }
  const placed = placedAt.get(ref.id);
  if (!placed) {
    throw new TypedError.NotFound(`No record has the id ${ref.id}.`);
  }
  return placed.dir;
}

/** Drops a record from the index once its folder is gone. */
export function forgetRecord(id: TaskId): void {
  placedAt.delete(id);
  const known = read();
  const chat = known.chats.get(id);
  if (chat) {
    known.chats.delete(id);
    known.sessions.delete(chat.sessionId);
  }
}

/**
 * Takes a record resolved by another process, and from then on answers only
 * for the records handed in, without reading the disk.
 */
export function handRecord(record: { dir: TaskDir; ref: RecordRef }): void {
  (handed ??= new Map()).set(record.ref.id, record);
}

/** Reads the index from disk again on its next use. */
export function forgetRecordFolders(): void {
  index = undefined;
}

/** Records a chat as it is made, and returns the folder it goes in. */
export function placeChat(id: ChatId, sessionId: StoreId.Session): ChatDir {
  const known = read();
  if (known.chats.has(id)) {
    throw new Error(`A record already has the id ${id}.`);
  }
  known.chats.set(id, { id, sessionId });
  known.sessions.set(sessionId, id);
  return chatDir(id);
}

/**
 * Records a task in a folder of the caller's choosing, under `chatId`,
 * replacing where the id was placed before. For tests, whose tasks keep their
 * files in a temporary folder.
 */
export function placeTaskAt(id: TaskId, chatId: ChatId, dir: TaskDir): void {
  placedAt.set(id, { chatId, dir });
}

/**
 * The folder a record lives in. The window, which is no record, has a folder
 * of its own in the workspace's `.instrument/`. An id no record has throws
 * `TypedError.NotFound` rather than naming a folder that is not there; ask
 * `resolveRecord` where an unknown id is an answer rather than a mistake.
 */
export function recordDir(id: TaskId): TaskDir {
  if (id === WINDOW_ID) {
    return TaskDirSchema.parse(windowDir());
  }
  const given = handed?.get(id) ?? placedAt.get(id);
  if (given) {
    return given.dir;
  }
  const ref = resolveRecord(id);
  if (ref.isErr()) {
    throw ref.error;
  }
  return dirOf(ref.value);
}

/**
 * Whether any record already has this id: ids are unique across the whole
 * workspace, so a name picked for a chat has to check every chat, and the
 * `tasks/` folder an earlier version left, whose tasks keep their ids when
 * they move into a chat. The window's id is never free, since its scope goes
 * by it.
 */
export function recordIdTaken(id: string): boolean {
  const parsed = TaskIdSchema.safeParse(id);
  if (!parsed.success) {
    return false;
  }
  const known = read();
  return (
    parsed.data === WINDOW_ID ||
    known.chats.has(parsed.data) ||
    fs.existsSync(path.join(chatsDir(), parsed.data)) ||
    fs.existsSync(path.join(getWorkspaceConfig().tasksDir, parsed.data))
  );
}

/**
 * What a record is: a chat, or a task a test placed. An id that names no
 * record, the window's among them, is `NotFound`.
 */
export function resolveRecord(
  id: string,
): Result<RecordRef, TypedError.NotFound> {
  const parsed = TaskIdSchema.safeParse(id);
  if (!parsed.success || parsed.data === WINDOW_ID) {
    return err(new TypedError.NotFound(`No record has the id ${id}.`));
  }
  if (handed) {
    const given = handed.get(parsed.data);
    return given
      ? ok(given.ref)
      : err(new TypedError.NotFound(`No record has the id ${id}.`));
  }
  const placed = placedAt.get(parsed.data);
  if (placed) {
    return ok({ chatId: placed.chatId, id: parsed.data, kind: "task" });
  }
  const known = read();
  const ref = refIn(known, parsed.data) ?? discover(known, parsed.data);
  return ref
    ? ok(ref)
    : err(new TypedError.NotFound(`No record has the id ${id}.`));
}

/** The session a chat's record holds. */
export function sessionOfChat(id: ChatId): StoreId.Session | undefined {
  return read().chats.get(id)?.sessionId;
}

/**
 * The session a chat's settings name, read straight from its file, or why
 * there is none: settings that cannot be read, or that name no session.
 */
export function storedChatSession(
  chatFolder: string,
):
  | { problem: "no-session" | "unreadable-settings" }
  | { sessionId: StoreId.Session } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      fs.readFileSync(
        path.join(
          chatFolder,
          TASK_PRIVATE_FOLDER_NAME,
          TASK_SETTINGS_FILE_NAME,
        ),
        "utf8",
      ),
    );
  } catch {
    return { problem: "unreadable-settings" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { problem: "unreadable-settings" };
  }
  const session = StoreId.SessionSchema.safeParse(
    "chatSessionId" in parsed ? parsed.chatSessionId : undefined,
  );
  return session.success
    ? { sessionId: session.data }
    : { problem: "no-session" };
}

/**
 * Adds a chat found in its folder to the index, or nothing when its settings
 * name no session: such a folder is unreachable as a chat until they do, and
 * listed in Settings > Storage meanwhile.
 */
function addChatFrom(known: Index, folder: string): ChatId | undefined {
  const id = ChatIdSchema.safeParse(path.basename(folder));
  const stored = id.success ? storedChatSession(folder) : undefined;
  if (!id.success || !stored || !("sessionId" in stored)) {
    return undefined;
  }
  known.chats.set(id.data, { id: id.data, sessionId: stored.sessionId });
  known.sessions.set(stored.sessionId, id.data);
  return id.data;
}

/**
 * A chat the index has not heard of, looked for under `chats/`, where one
 * made behind its back would be.
 */
function discover(known: Index, id: TaskId): RecordRef | undefined {
  const chatFolder = path.join(known.root, CHATS_DIR_NAME, id);
  if (!isDir(chatFolder)) {
    return undefined;
  }
  const chatId = addChatFrom(known, chatFolder);
  return chatId === undefined ? undefined : { id: chatId, kind: "chat" };
}

function isDir(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function read(): Index {
  const { rootDir } = getWorkspaceConfig();
  if (handed) {
    // Nothing but what was handed in: an empty index, never a scan.
    return { chats: new Map(), root: rootDir, sessions: new Map() };
  }
  if (index?.root === rootDir) {
    return index;
  }
  const known: Index = { chats: new Map(), root: rootDir, sessions: new Map() };
  const dir = absolutePathJoin(rootDir, CHATS_DIR_NAME);
  let skipped = 0;
  for (const name of listDirs(dir)) {
    if (addChatFrom(known, path.join(dir, name)) === undefined) {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`Skipping ${skipped} chat folder(s) with no session`);
  }
  index = known;
  return known;
}

function refIn(known: Index, id: TaskId): RecordRef | undefined {
  const chat = known.chats.get(id);
  return chat ? { id: chat.id, kind: "chat" } : undefined;
}
