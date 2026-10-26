import { SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { CHATS_FOLDER_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  type ChatDir,
  ChatDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { WINDOW_ID } from "../schemas/window-id";
import {
  chatFolderNames,
  chatLinkedInFolder,
  folderLinkedTo,
} from "./chat-folders/own-folder";
import { parseRecordFileName } from "./records/file-names";
import { TypedError } from "./errors";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where every chat is, for the chats folder it was read from. A chat's folder
 * has a readable name of its own, so which session is its own is read from
 * its records (`chatSessionIn`). The index is read from disk the first time a workspace asks, and
 * kept current by whatever makes or trashes a chat. An id it does not know
 * is looked for on disk where a chat would be before it is called not found,
 * so a folder made behind its back is found; one moved behind its back (the
 * layout migration) calls `forgetChatFolders`. A chat's tasks are sessions
 * in its store, and its work is in its work folder (`workDir`), apart from
 * the record folder named here.
 */
interface Index {
  /** Each chat's one session, by its id. */
  chats: Map<ChatId, StoreId.Session>;
  root: string;
  /** Each chat's id, by its session. */
  sessions: Map<StoreId.Session, ChatId>;
}

let index: Index | undefined;

/**
 * The chats this process was handed and the folder each is in, in a process
 * that is told its chat rather than reading the index (the bash worker,
 * handed the one its command runs in). Set, it is the whole answer: an id
 * not in it is not found, and the index is never read from disk.
 */
let handed: Map<ChatId, ChatDir> | undefined;

/**
 * The folder a chat's records live in: its logs, settings files,
 * `attachments/` and handoff notes. An id no chat has, the window's among
 * them, throws `TypedError.NotFound` rather than naming a folder that is not
 * there; ask `resolveChat` where an unknown id is an answer rather than a
 * mistake.
 */
export function chatDir(id: ChatId): ChatDir {
  const given = handed?.get(id);
  if (given) {
    return given;
  }
  if (resolveChat(id) === undefined) {
    throw new TypedError.NotFound(`No chat has the id ${id}.`);
  }
  return folderOf(id);
}

/**
 * Whether any chat already has this id: ids are unique across the whole
 * workspace, so a name picked for a chat has to check every chat, and the
 * `tasks/` folder 1.x left, whose tasks keep their ids when they move into a
 * chat. The window's id is never free, since its scope goes by it.
 */
export function chatIdTaken(id: string): boolean {
  const parsed = ChatIdSchema.safeParse(id);
  if (!parsed.success) {
    return false;
  }
  const known = read();
  return (
    parsed.data === WINDOW_ID ||
    known.chats.has(parsed.data) ||
    fs.existsSync(folderOf(parsed.data)) ||
    legacyTaskTaken(parsed.data)
  );
}

/** Whether 1.x left a task under this id, in a workspace that kept its tasks. */
function legacyTaskTaken(id: ChatId): boolean {
  const { legacyTasksDir } = getWorkspaceConfig();
  return (
    legacyTasksDir !== undefined && fs.existsSync(path.join(legacyTasksDir, id))
  );
}

/** Every chat's id. */
export function chatIds(): ChatId[] {
  return [...read().chats.keys()];
}

/** The chat a session is, or none for a session that is not a chat's. */
export function chatOfSession(sessionId: StoreId.Session): ChatId | undefined {
  return read().sessions.get(sessionId);
}

/** The folder every chat is in. */
export function chatsDir(): AbsolutePath {
  return getWorkspaceConfig().chatsDir;
}

/** Drops a chat from the index once its folder is gone. */
export function forgetChat(id: ChatId): void {
  const known = read();
  const sessionId = known.chats.get(id);
  if (sessionId) {
    known.chats.delete(id);
    known.sessions.delete(sessionId);
  }
}

/** Reads the index from disk again on its next use. */
export function forgetChatFolders(): void {
  index = undefined;
}

/**
 * Takes a chat resolved by another process, and from then on answers only
 * for the chats handed in, without reading the disk.
 */
export function handChat(chat: { dir: ChatDir; id: ChatId }): void {
  (handed ??= new Map()).set(chat.id, chat.dir);
}

/** Records a chat as it is made, and returns the folder it goes in. */
export function placeChat(id: ChatId, sessionId: StoreId.Session): ChatDir {
  const known = read();
  if (known.chats.has(id)) {
    throw new Error(`A chat already has the id ${id}.`);
  }
  known.chats.set(id, sessionId);
  known.sessions.set(sessionId, id);
  return folderOf(id);
}

/**
 * An id as a chat's, or none for one no chat has, the window's among them.
 */
export function resolveChat(id: string): ChatId | undefined {
  const parsed = ChatIdSchema.safeParse(id);
  if (!parsed.success || parsed.data === WINDOW_ID) {
    return undefined;
  }
  if (handed) {
    return handed.has(parsed.data) ? parsed.data : undefined;
  }
  const known = read();
  return known.chats.has(parsed.data)
    ? parsed.data
    : discover(known, parsed.data);
}

/** The session a chat's record holds. */
export function sessionOfChat(id: ChatId): StoreId.Session | undefined {
  return read().chats.get(id);
}

/**
 * Where the chat's own folder under `Chats/` is, the one the person sees,
 * or nothing for a chat that has none yet and for the window: the folder
 * this computer last recorded while it is there, else the one folder no
 * other chat claims whose `CHAT.md` names this chat (a folder renamed in a
 * file manager), else the recorded name, for a folder the next turn makes
 * again.
 *
 * Read synchronously because the filesystem layout a chat's shell runs
 * under is built synchronously, and the folder is one of its mounts. The
 * one place that answer is worked out, so the shell's `$INSTRUMENT_OUTPUT`
 * and what the model is told about it cannot drift apart after the folder
 * follows a title.
 */
export function chatOwnFolder(chatFolder: string): AbsolutePath | undefined {
  const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
  const names = chatFolderNames(workspaceMachineDir);
  const id = ChatIdSchema.safeParse(path.basename(chatFolder));
  const name = names.get(path.basename(chatFolder));
  const chats = path.join(rootDir, CHATS_FOLDER_NAME);
  if (name !== undefined && isDir(path.join(chats, name))) {
    return AbsolutePathSchema.parse(path.join(chats, name));
  }
  const found = id.success ? folderLinkedTo(chats, id.data, names) : undefined;
  const own = found ?? name;
  return own === undefined
    ? undefined
    : AbsolutePathSchema.parse(path.join(chats, own));
}

/**
 * The chat whose own folder `at` is: a folder whose `CHAT.md` names a chat
 * that is still there and that the chat takes as its own (`chatOwnFolder`).
 * A copy of one names the chat too and is only files, so it has none.
 */
export function chatOfOwnFolder(at: string): ChatId | undefined {
  const named = chatLinkedInFolder(at);
  const id = named && resolveChat(named);
  const own = id && chatOwnFolder(chatDir(id));
  const comparable = (each: string) => path.resolve(each).normalize("NFC");
  return own !== undefined && comparable(own) === comparable(at)
    ? id
    : undefined;
}

/**
 * The chat's own session, read from the records in its folder: the session
 * that was not started from another one, which a log's header says. The
 * first line of each session's logs is read, oldest session first, until
 * one with no parent; the chat's own is almost always the oldest. Nothing a
 * device rewrites decides it, so a damaged file beside the logs cannot hide
 * a chat.
 *
 * A folder whose logs are all tasks' has none: a task's log can arrive by
 * sync before the chat's own, and the chat is found once that one does
 * rather than opened as the task.
 *
 * A folder with no logs yet is a chat still on its `chat.db`, which the
 * database converter retries at each launch; its `settings.json`, which
 * named the session before records did, is read for it, and nothing else
 * reads that file.
 */
export function chatSessionIn(chatFolder: string): StoreId.Session | undefined {
  const logs = new Map<StoreId.Session, string[]>();
  for (const name of listFiles(chatFolder).toSorted()) {
    const parsed = parseRecordFileName(name);
    if (parsed?.kind === "log" && parsed.copy === undefined) {
      logs.set(parsed.session, [...(logs.get(parsed.session) ?? []), name]);
    }
  }
  if (logs.size === 0) {
    return sessionInSettingsFile(chatFolder);
  }
  return [...logs.keys()]
    .toSorted()
    .find((session) =>
      (logs.get(session) ?? []).some((name) =>
        isRootHeader(firstLineOf(path.join(chatFolder, name))),
      ),
    );
}

/**
 * Whether a log's first line is a session header that names no parent. Read
 * without the record schemas, which reach most of the package.
 */
function isRootHeader(line: string | undefined): boolean {
  if (line === undefined) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(line);
    return (
      typeof value === "object" &&
      value !== null &&
      "t" in value &&
      value.t === "session" &&
      !("parent" in value)
    );
  } catch {
    return false;
  }
}

/** The first whole line of a file. */
function firstLineOf(file: string): string | undefined {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(handle, buffer, 0, HEADER_BYTES, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const end = text.indexOf("\n");
    return end === -1 ? undefined : text.slice(0, end);
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

/** The session a chat's `settings.json` names, from builds before its records did. */
function sessionInSettingsFile(
  chatFolder: string,
): StoreId.Session | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      fs.readFileSync(path.join(chatFolder, SETTINGS_FILE_NAME), "utf8"),
    );
  } catch {
    return undefined;
  }
  const session = StoreId.SessionSchema.safeParse(
    typeof parsed === "object" && parsed !== null && "chatSessionId" in parsed
      ? parsed.chatSessionId
      : undefined,
  );
  return session.success ? session.data : undefined;
}

/**
 * Adds a chat found in its folder to the index, or nothing when its records
 * name no session: such a folder is unreachable as a chat until they do, and
 * listed in Settings > Storage meanwhile.
 */
function addChatFrom(known: Index, folder: string): ChatId | undefined {
  const id = ChatIdSchema.safeParse(path.basename(folder));
  const sessionId = id.success ? chatSessionIn(folder) : undefined;
  if (!id.success || sessionId === undefined) {
    return undefined;
  }
  known.chats.set(id.data, sessionId);
  known.sessions.set(sessionId, id.data);
  return id.data;
}

/**
 * A chat the index has not heard of, looked for under `chats/`, where one
 * made behind its back would be.
 */
function discover(known: Index, id: ChatId): ChatId | undefined {
  const folder = path.join(known.root, id);
  return isDir(folder) ? addChatFrom(known, folder) : undefined;
}

function folderOf(id: ChatId): ChatDir {
  return ChatDirSchema.parse(path.join(chatsDir(), id));
}

function isDir(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** How much of a log is read for its header, which is one short line. */
const HEADER_BYTES = 16 * 1024;

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
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
  const root = chatsDir();
  if (handed) {
    // Nothing but what was handed in: an empty index, never a scan.
    return { chats: new Map(), root, sessions: new Map() };
  }
  if (index?.root === root) {
    return index;
  }
  const known: Index = { chats: new Map(), root, sessions: new Map() };
  const skipped: string[] = [];
  for (const name of listDirs(root)) {
    if (addChatFrom(known, path.join(root, name)) === undefined) {
      skipped.push(name);
    }
  }
  if (skipped.length > 0) {
    console.warn(
      `Skipping chat folders with no session: ${skipped.join(", ")}`,
    );
  }
  index = known;
  return known;
}
