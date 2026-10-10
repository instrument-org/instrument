import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import {
  type AbsolutePath,
  type ChatDir,
  ChatDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { WINDOW_ID } from "../schemas/window-id";
import { TypedError } from "./errors";
import { windowDir } from "./window-paths";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where every chat is, for the chats folder it was read from. A chat's folder
 * has a readable name of its own, so which session it holds is read from its
 * settings. The index is read from disk the first time a workspace asks, and
 * kept current by whatever makes or trashes a chat. An id it does not know
 * is looked for on disk where a chat would be before it is called not found,
 * so a folder made behind its back is found; one moved behind its back (the
 * layout migration) calls `forgetChatFolders`. A `tasks/` folder an earlier
 * version left inside a chat is nobody's: a chat's tasks are sessions in its
 * store.
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
 * The folder a chat lives in. The window, which is no chat, has a folder of
 * its own in the workspace's `.instrument/`. An id no chat has throws
 * `TypedError.NotFound` rather than naming a folder that is not there; ask
 * `resolveChat` where an unknown id is an answer rather than a mistake.
 */
export function chatDir(id: ChatId): ChatDir {
  if (id === WINDOW_ID) {
    return ChatDirSchema.parse(windowDir());
  }
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
    fs.existsSync(path.join(getWorkspaceConfig().tasksDir, parsed.data))
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
        path.join(chatFolder, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
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
  known.chats.set(id.data, stored.sessionId);
  known.sessions.set(stored.sessionId, id.data);
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
  let skipped = 0;
  for (const name of listDirs(root)) {
    if (addChatFrom(known, path.join(root, name)) === undefined) {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`Skipping ${skipped} chat folder(s) with no session`);
  }
  index = known;
  return known;
}
