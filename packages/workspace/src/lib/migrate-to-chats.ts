import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { group } from "radashi";
import { z } from "zod";

import {
  CHATS_DIR_NAME,
  TASK_DB_FILE_NAME,
  TASK_FOLDER_NAMES,
  TASKS_DIR_NAME,
} from "../constants";
import { MOUNT } from "../mount-points";
import { StoreId } from "../schemas/store-id";
import { chatFolderName } from "./generate-task-folder-name";
import {
  readTopicsSync,
  type Topic,
  unusedTopicName,
  writeTopicSync,
} from "./chat/topics";
import { forgetRecordFolders } from "./record-folders";
import { writeJsonFileSync } from "./write-json-file-sync";

// Where the window record's settings and database are kept as they were before
// the move, for a release, so a migration that went wrong can be undone by hand.
const BACKUP_DIR_NAME = ".pre-chats";

// Keys of the window's state that only the one-conversation layout used: the
// channels themselves, and a draft the window keeps in its own storage. The
// topics, and the two maps of which chat started which task, are dropped
// separately, and only once everything they name has moved.
// The files still to be moved from the window into chats, kept beside the
// window's settings until every move in it is done. It is what a later boot
// retries from, since the rows that said which chat a file belongs to are gone
// from the window by then.
const FILE_MOVES_FILE_NAME = "chat-file-moves.json";

// The folders of the window whose files and folders go to the chats that use
// them. A command's spilled output goes by its part id instead.
const FILE_FOLDERS: readonly string[] = [
  TASK_FOLDER_NAMES.attachments,
  TASK_FOLDER_NAMES.downloads,
  TASK_FOLDER_NAMES.screenshots,
  TASK_FOLDER_NAMES.work,
];

// A document whose relative references are followed, so a page takes the
// images, styles and pages it loads with it; how much of one is read; and how
// many are read inside one folder.
const DOCUMENT_FILE = /\.(?:css|html?|markdown|md|svg)$/i;
const DOCUMENT_READ_LIMIT = 2 * 1024 * 1024;
const FOLDER_DOCUMENT_LIMIT = 200;

// A path a document loads: an HTML or SVG attribute, a CSS `url()` or
// `@import`, or a Markdown link or image.
const REFERENCE =
  /\b(?:data|href|poster|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')\s]+)|@import\s+["']([^"']+)["']|\]\(\s*<?([^)\s>]+)/gi;

const FileMovesSchema = z.array(
  z.object({
    /** The chat folder it goes to. */
    chat: z.string(),
    /** A file or folder, relative to the window's folder; it lands at the same path in the chat. */
    from: z.string(),
    /** Set while a session that is not a chat yet also uses it, so the window keeps its own. */
    keep: z.boolean().optional(),
    /** The session the chat holds, so a move never lands in a chat that holds another. */
    session: z.string(),
  }),
);
type FileMove = z.output<typeof FileMovesSchema>[number];

const RETIRED_STATE_KEYS = new Set(["appChannels", "channels", "promptDraft"]);
const TASK_MAP_KEYS = new Set(["taskChannels", "taskThreads"]);

const STORE_SCHEMA = `CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        value TEXT,
        blob BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;

export interface ChatsMigration {
  chatCount: number;
  /** Chats, tasks and files that could not be moved this time, and are tried again next boot. */
  leftOver: number;
  movedTaskCount: number;
  topicCount: number;
}

interface StoredSession {
  createdAt?: string;
  id: StoreId.Session;
  parentId?: string;
  title?: string;
  updatedAt?: string;
}

interface StoreRow {
  blob: null | Uint8Array;
  created_at: null | string;
  key: string;
  updated_at: null | string;
  value: null | string;
}

/**
 * Moves a workspace from one conversation holding every chat to a record per
 * chat. Each top-level session of the window's record becomes a folder under
 * `chats/`, named the way a task is (the day it began and a few words of its
 * title), with its rows copied into a database of its own and its session
 * named in its settings; each task a thread or a channel started moves into
 * that chat's `tasks/` with the chat as its parent; a file sent in a chat and
 * a command's spilled output move with it; the topics become files; and the
 * window keeps only what is the window's. Synchronous and file-level, like the
 * rest of the boot migration: no store is open, and the workspace's config is
 * not set yet.
 *
 * Runs on every boot and decides from the data rather than a marker: a
 * window record whose database still holds a chat's session, or whose state
 * still names the old maps, is moved; one that does not is left alone. So a
 * build that wrote the old layout again (an older beta run in between) is
 * caught on the next boot of this one.
 *
 * Each item moves on its own, so one that fails (a folder another program
 * holds open, say) is left for the next boot and the rest go on. What records
 * where an item belongs is only let go once the item has moved, or once it is
 * written down elsewhere: a chat's rows leave the window's database only once
 * its own database holds them and the window's list of file moves names every
 * file they placed, and the maps of which chat started which task only once
 * every task in them moved.
 */
export function migrateToChats(rootDir: string): ChatsMigration {
  const migration: ChatsMigration = {
    chatCount: 0,
    leftOver: 0,
    movedTaskCount: 0,
    topicCount: 0,
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const windows = windowRecordIds(tasksDir);
  const waiting = windows.filter((windowId) =>
    holdsOneConversation(path.join(tasksDir, windowId)),
  );
  for (const windowId of windows) {
    if (waiting.includes(windowId)) {
      const moved = migrateWindow(rootDir, windowId);
      migration.chatCount += moved.chatCount;
      migration.leftOver += moved.leftOver;
      migration.movedTaskCount += moved.movedTaskCount;
      migration.topicCount += moved.topicCount;
    }
    // Whether or not the window still holds a conversation: a move an earlier
    // boot could not make is on its list.
    migration.leftOver += moveFiles(rootDir, path.join(tasksDir, windowId));
  }
  if (waiting.length > 0) {
    forgetRecordFolders();
  }
  return migration;
}

/** Copies the window's private folder aside once, whole or not at all. */
function backUp(rootDir: string, windowId: string, privateDir: string) {
  const backup = path.join(
    rootDir,
    BACKUP_DIR_NAME,
    windowId,
    TASK_PRIVATE_FOLDER_NAME,
  );
  if (fs.existsSync(backup)) {
    return;
  }
  const partial = `${backup}.partial`;
  fs.rmSync(partial, { force: true, recursive: true });
  fs.cpSync(privateDir, partial, { recursive: true });
  fs.renameSync(partial, backup);
}

/**
 * The chats already made, by the session each holds, read from their
 * settings: what lets a rerun find the chat an earlier run made.
 */
function chatsBySession(chatsDir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of readDirs(chatsDir)) {
    const settings = readJson(
      path.join(
        chatsDir,
        name,
        TASK_PRIVATE_FOLDER_NAME,
        TASK_SETTINGS_FILE_NAME,
      ),
    );
    if (typeof settings?.chatSessionId === "string") {
      found.set(settings.chatSessionId, name);
    }
  }
  return found;
}

/**
 * Copies a file or folder through a temporary name beside it, so an
 * interrupted copy never leaves a partial one where a chat reads it.
 */
function copyInto(source: string, to: string) {
  const partial = path.join(
    path.dirname(to),
    `.${path.basename(to)}.${process.pid}.partial`,
  );
  fs.rmSync(partial, { force: true, recursive: true });
  try {
    fs.cpSync(source, partial, { recursive: true, verbatimSymlinks: true });
    fs.renameSync(partial, to);
  } catch (error) {
    fs.rmSync(partial, { force: true, recursive: true });
    throw error;
  }
}

/** The documents in a file or folder, up to a limit for a folder. */
function documentsIn(target: string): string[] {
  try {
    if (!fs.statSync(target).isDirectory()) {
      return DOCUMENT_FILE.test(target) ? [target] : [];
    }
    return fs
      .readdirSync(target, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && DOCUMENT_FILE.test(entry.name))
      .slice(0, FOLDER_DOCUMENT_LIMIT)
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * Whether a window record is still in the one-conversation layout: chat
 * sessions in its database, or the maps that layout kept in its state.
 */
function holdsOneConversation(windowDir: string): boolean {
  const privateDir = path.join(windowDir, TASK_PRIVATE_FOLDER_NAME);
  const state = readJson(path.join(privateDir, TASK_SETTINGS_FILE_NAME))?.state;
  // Not the draft: a window can write one of its own in either layout.
  if (
    isRecord(state) &&
    ["channels", "taskChannels", "taskThreads", "topics"].some(
      (key) => state[key] !== undefined,
    )
  ) {
    return true;
  }
  const dbPath = path.join(privateDir, TASK_DB_FILE_NAME);
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (
      db
        .prepare("select 1 from sessions where key like 'sessions:%' limit 1")
        .get() !== undefined
    );
  } catch {
    return false;
  } finally {
    db.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The item at the top of the window's folders that a reference in a document
 * points into, when it points at something there: not a URL, a fragment, or a
 * path outside the window.
 */
function itemAt(
  windowDir: string,
  document: string,
  reference: string,
): string | undefined {
  const bare = reference.split(/[#?]/)[0] ?? "";
  if (!bare || /^[a-z][\w+.-]*:/i.test(bare) || bare.startsWith("//")) {
    return undefined;
  }
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A stray `%` in a real file name: take the reference as written.
  }
  const taskRoot = `${MOUNT.task}/`;
  const target = decoded.startsWith(taskRoot)
    ? path.join(windowDir, decoded.slice(taskRoot.length))
    : decoded.startsWith("/")
      ? undefined
      : path.resolve(path.dirname(document), decoded);
  if (!target || !present(target)) {
    return undefined;
  }
  const [folder, name] = path.relative(windowDir, target).split(/[/\\]/);
  return folder &&
    name &&
    FILE_FOLDERS.includes(folder) &&
    !name.startsWith(".")
    ? `${folder}/${name}`
    : undefined;
}

/**
 * The other items at the top of the window's folders that the documents in
 * one load by relative path (or by a path under `/task`).
 */
function loadedItems(windowDir: string, item: string): string[] {
  const found = new Set<string>();
  for (const document of documentsIn(path.join(windowDir, item))) {
    let text: string;
    try {
      if (fs.statSync(document).size > DOCUMENT_READ_LIMIT) {
        continue;
      }
      text = fs.readFileSync(document, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(REFERENCE)) {
      const reference = match.slice(1).find(Boolean);
      const loaded =
        reference === undefined
          ? undefined
          : itemAt(windowDir, document, reference);
      if (loaded && loaded !== item) {
        found.add(loaded);
      }
    }
  }
  return [...found];
}

/**
 * Whether a chat's parts name a file of the window's by its own name, as a
 * whole path segment, so `a.png` is found neither inside `data.png` nor in
 * `a.png.bak`. A folder is named by a path through it (`report/index.html`)
 * or a path ending in it (`/task/work/report`), not by the bare word.
 */
function mentions(texts: string[], name: string, isFolder: boolean): boolean {
  const escaped = name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  const pattern = new RegExp(
    isFolder
      ? String.raw`(^|[\s/"\\])${escaped}/|/${escaped}($|[^\w.-])`
      : String.raw`(^|[\s/"\\])${escaped}($|[^\w.-])`,
  );
  return texts.some((text) => pattern.test(text));
}

function migrateWindow(rootDir: string, windowId: string): ChatsMigration {
  const migration: ChatsMigration = {
    chatCount: 0,
    leftOver: 0,
    movedTaskCount: 0,
    topicCount: 0,
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const chatsDir = path.join(rootDir, CHATS_DIR_NAME);
  const windowDir = path.join(tasksDir, windowId);
  const privateDir = path.join(windowDir, TASK_PRIVATE_FOLDER_NAME);
  backUp(rootDir, windowId, privateDir);

  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  const settings = readJson(settingsPath) ?? {};
  const state = isRecord(settings.state) ? settings.state : {};

  // Every name already in use, so a chat's name is unique across the chats,
  // the tasks inside them, and the tasks no chat owns.
  const made = chatsBySession(chatsDir);
  const taken = new Set([
    ...readDirs(chatsDir),
    ...readDirs(chatsDir).flatMap((chat) =>
      readDirs(path.join(chatsDir, chat, TASKS_DIR_NAME)),
    ),
    ...readDirs(tasksDir),
  ]);

  // The rows of every top-level session, and of each sub-agent session under
  // its top-level one.
  const dbPath = path.join(privateDir, TASK_DB_FILE_NAME);
  const { globals, groups, sessions } = readWindowRows(dbPath);

  // Each session becomes a chat. A chat that fails to write keeps its rows
  // in the window, where the next boot finds them again.
  const chatOf = new Map<StoreId.Session, string>();
  // The chats this run wrote whole: the only ones whose rows may leave the
  // window. One an earlier boot began and this one could not finish keeps
  // its rows where they are.
  const written = new Set<StoreId.Session>();
  const failed = new Set<StoreId.Session>();
  for (const [sessionId, chatRows] of groups) {
    const session = sessions.get(sessionId);
    if (!session) {
      continue;
    }
    try {
      const name =
        made.get(sessionId) ??
        chatFolderName({
          date: validDate(session.createdAt) ?? new Date(),
          isTaken: (candidate) => taken.has(candidate),
          title: session.title,
        });
      taken.add(name);
      writeChat({
        chatDir: path.join(chatsDir, name),
        rows: [...globals, ...chatRows],
        session,
        windowSettings: settings,
        windowState: state,
      });
      chatOf.set(sessionId, name);
      written.add(sessionId);
      if (!made.has(sessionId)) {
        migration.chatCount += 1;
      }
    } catch {
      failed.add(sessionId);
      migration.leftOver += 1;
    }
  }
  // A chat an earlier boot made whole, whose rows are already gone from the
  // window, still takes its tasks and files.
  for (const [sessionId, name] of made) {
    const parsed = StoreId.SessionSchema.safeParse(sessionId);
    if (
      parsed.success &&
      !chatOf.has(parsed.data) &&
      !failed.has(parsed.data)
    ) {
      chatOf.set(parsed.data, name);
    }
  }

  const tasksLeft = moveTasks({
    chatOf,
    chatsDir,
    sessions: new Set(groups.keys()),
    state,
    tasksDir,
  });
  migration.movedTaskCount += tasksLeft.moved;
  // Where each file goes is written down before the rows that say so leave
  // the window, so a move that fails is retried from the list alone.
  let filesRecorded = true;
  try {
    recordFileMoves(windowDir, planFileMoves({ chatOf, groups, windowDir }));
  } catch {
    filesRecorded = false;
    migration.leftOver += 1;
  }
  const topics = writeTopics(rootDir, state);
  migration.topicCount += topics.written;
  migration.leftOver += tasksLeft.left + topics.left;

  // Last, once everything that reads them has: a chat's rows leave the
  // window's database only once its own database holds them, all in one
  // transaction. The window keeps the rest: its tabs' browser records, the
  // store's own version, and any session that could not become a chat.
  if (filesRecorded && written.size > 0 && fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    try {
      const remove = db.prepare("delete from sessions where key = ?");
      db.exec("BEGIN");
      for (const [sessionId, rows] of groups) {
        if (!written.has(sessionId)) {
          continue;
        }
        for (const row of rows) {
          remove.run(row.key);
        }
      }
      db.exec("COMMIT");
    } catch {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      migration.leftOver += 1;
    } finally {
      db.close();
    }
  }

  writeJsonFileSync(settingsPath, {
    ...settings,
    state: Object.fromEntries(
      Object.entries(state).filter(
        ([key]) =>
          !RETIRED_STATE_KEYS.has(key) &&
          !(key === "topics" && topics.left === 0) &&
          !(TASK_MAP_KEYS.has(key) && tasksLeft.left === 0),
      ),
    ),
  });
  return migration;
}

/**
 * Makes the moves on the window's list. A file or folder more than one chat
 * uses is copied to each but the last, which takes the original, and only once
 * every copy landed, so a failed copy keeps its source for the next boot. One
 * a session that is not a chat yet also uses is only copied. A move whose
 * source is gone, whose chat no longer holds its session, or whose
 * destination is already taken is dropped: nothing is overwritten. Returns how
 * many moves are still to be made.
 */
function moveFiles(rootDir: string, windowDir: string): number {
  const listPath = path.join(
    windowDir,
    TASK_PRIVATE_FOLDER_NAME,
    FILE_MOVES_FILE_NAME,
  );
  if (!fs.existsSync(listPath)) {
    return 0;
  }
  const chatsDir = path.join(rootDir, CHATS_DIR_NAME);
  const chatOfSession = chatsBySession(chatsDir);
  const left: FileMove[] = [];
  for (const [from, moves] of Object.entries(
    group(readFileMoves(listPath), (move) => move.from),
  )) {
    if (!moves) {
      continue;
    }
    const source = path.join(windowDir, from);
    const due = moves.filter(
      (move) =>
        chatOfSession.get(move.session) === move.chat &&
        present(source) &&
        !present(path.join(chatsDir, move.chat, from)),
    );
    const last = moves.some((move) => move.keep) ? undefined : due.at(-1);
    let failed = false;
    for (const move of due) {
      const to = path.join(chatsDir, move.chat, from);
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (move === last && !failed) {
          fs.renameSync(source, to);
        } else {
          copyInto(source, to);
        }
      } catch {
        failed = true;
        left.push(move);
      }
    }
  }
  try {
    if (left.length === 0) {
      fs.rmSync(listPath, { force: true });
    } else {
      writeJsonFileSync(listPath, left);
    }
  } catch {
    // The list as it was stays, and the next boot drops what already moved.
  }
  return left.length;
}

/**
 * Each task a thread or a channel started moves into that chat: the folder
 * first, then its settings where it landed, so a task is never left in
 * `tasks/` already naming a chat it is not in. Then every task in a chat is
 * made to name it, which also finishes a move an interrupted run began.
 */
function moveTasks({
  chatOf,
  chatsDir,
  sessions,
  state,
  tasksDir,
}: {
  chatOf: Map<StoreId.Session, string>;
  chatsDir: string;
  /** The sessions still in the window, which may yet become chats. */
  sessions: Set<StoreId.Session>;
  state: Record<string, unknown>;
  tasksDir: string;
}): { left: number; moved: number } {
  const filedIn: Record<string, unknown> = {
    ...(isRecord(state.taskChannels) ? state.taskChannels : {}),
    ...(isRecord(state.taskThreads) ? state.taskThreads : {}),
  };
  let left = 0;
  let moved = 0;
  for (const [taskName, sessionId] of Object.entries(filedIn)) {
    const parsed = StoreId.SessionSchema.safeParse(sessionId);
    const chat = parsed.success ? chatOf.get(parsed.data) : undefined;
    const from = path.join(tasksDir, taskName);
    if (!fs.existsSync(from)) {
      continue;
    }
    if (!chat) {
      // Its chat is still to be made: the map has to stay for a later boot.
      if (parsed.success && sessions.has(parsed.data)) {
        left += 1;
      }
      continue;
    }
    const to = path.join(chatsDir, chat, TASKS_DIR_NAME, taskName);
    try {
      if (fs.existsSync(to)) {
        throw new Error(`${to} already exists`);
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moved += 1;
    } catch {
      left += 1;
    }
  }
  for (const chat of new Set(chatOf.values())) {
    const inside = path.join(chatsDir, chat, TASKS_DIR_NAME);
    for (const taskName of readDirs(inside)) {
      const taskSettingsPath = path.join(
        inside,
        taskName,
        TASK_PRIVATE_FOLDER_NAME,
        TASK_SETTINGS_FILE_NAME,
      );
      const taskSettings = readJson(taskSettingsPath);
      if (taskSettings && taskSettings.parentTaskId !== chat) {
        writeJsonFileSync(taskSettingsPath, {
          ...taskSettings,
          parentTaskId: chat,
        });
      }
    }
  }
  return { left, moved };
}

/**
 * Which session uses each file and folder at the top of the window's folders,
 * and so which chats it goes to: a command's spilled output by the id of the
 * part it was written for, and anything else by its name in a chat's parts,
 * then everything a document it holds loads by relative path, as far as
 * that goes. A folder moves whole, so a page inside it keeps its own files.
 */
function planFileMoves({
  chatOf,
  groups,
  windowDir,
}: {
  chatOf: Map<StoreId.Session, string>;
  groups: Map<StoreId.Session, StoreRow[]>;
  windowDir: string;
}): FileMove[] {
  const users = new Map<string, Set<StoreId.Session>>();
  const unread: [string, StoreId.Session][] = [];
  const use = (item: string, session: StoreId.Session) => {
    const sessions = users.get(item) ?? new Set();
    if (!sessions.has(session)) {
      sessions.add(session);
      users.set(item, sessions);
      unread.push([item, session]);
    }
  };
  for (const name of readFiles(
    path.join(windowDir, TASK_FOLDER_NAMES.toolOutput),
  )) {
    const partId = name.split(".")[0] ?? name;
    for (const [session, rows] of groups) {
      if (rows.some((row) => row.key.endsWith(`:${partId}`))) {
        use(`${TASK_FOLDER_NAMES.toolOutput}/${name}`, session);
      }
    }
  }
  const texts = [...groups].map(
    ([session, rows]) =>
      [
        session,
        rows
          .filter((row) => row.key.startsWith("parts:"))
          .map((row) => textOf(row.blob)),
      ] as const,
  );
  for (const folder of FILE_FOLDERS) {
    for (const entry of readEntries(path.join(windowDir, folder))) {
      for (const [session, text] of texts) {
        if (mentions(text, entry.name, entry.isDirectory())) {
          use(`${folder}/${entry.name}`, session);
        }
      }
    }
  }
  for (let next = unread.pop(); next; next = unread.pop()) {
    const [item, session] = next;
    for (const loaded of loadedItems(windowDir, item)) {
      use(loaded, session);
    }
  }
  return [...users].flatMap(([from, sessions]) => {
    const keep = [...sessions].some((session) => !chatOf.has(session));
    return [...sessions].flatMap((session) => {
      const chat = chatOf.get(session);
      return chat ? [{ chat, from, session, ...(keep ? { keep } : {}) }] : [];
    });
  });
}

/** Whether anything stands at a path, a broken link included. */
function present(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function readDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** A folder's files, folders and links, but not its hidden ones. */
function readEntries(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          (entry.isFile() || entry.isDirectory() || entry.isSymbolicLink()) &&
          !entry.name.startsWith("."),
      );
  } catch {
    return [];
  }
}

function readFileMoves(file: string): FileMove[] {
  try {
    const parsed = FileMovesSchema.safeParse(
      JSON.parse(fs.readFileSync(file, "utf8")),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function readFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The window database's rows, grouped by the top-level session each belongs
 * to (a sub-agent session's under the session above it), with the rows that
 * belong to no session apart. A row whose session is not one the store would
 * take back is in no group, and stays where it is.
 */
function readWindowRows(dbPath: string) {
  const groups = new Map<StoreId.Session, StoreRow[]>();
  const sessions = new Map<string, StoredSession>();
  const globals: StoreRow[] = [];
  if (!fs.existsSync(dbPath)) {
    return { globals, groups, sessions };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // node:sqlite types a row as a record of any column value; these are the
    // store's own five columns, as the schema above declares them.
    const rows = db
      .prepare("select key, value, blob, created_at, updated_at from sessions")
      .all() as unknown as StoreRow[];
    for (const row of rows) {
      if (row.key.startsWith("sessions:")) {
        const session = storedSession(row.blob);
        if (session) {
          sessions.set(session.id, session);
        }
      }
    }
    const topOf = (sessionId: string): StoreId.Session | undefined => {
      let current = sessions.get(sessionId);
      const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        current = sessions.get(current.parentId);
      }
      return current && !current.parentId ? current.id : undefined;
    };
    for (const row of rows) {
      const segment = row.key.split(":")[1];
      if (segment === undefined) {
        globals.push(row);
        continue;
      }
      const top = topOf(segment);
      if (top) {
        groups.set(top, [...(groups.get(top) ?? []), row]);
      }
    }
  } finally {
    db.close();
  }
  return { globals, groups, sessions };
}

/**
 * Adds a run's moves to the window's list, a later plan for the same file and
 * chat replacing an earlier one.
 */
function recordFileMoves(windowDir: string, moves: FileMove[]) {
  if (moves.length === 0) {
    return;
  }
  const listPath = path.join(
    windowDir,
    TASK_PRIVATE_FOLDER_NAME,
    FILE_MOVES_FILE_NAME,
  );
  const merged = new Map(
    [...readFileMoves(listPath), ...moves].map((move) => [
      `${move.chat}\0${move.from}`,
      move,
    ]),
  );
  writeJsonFileSync(listPath, [...merged.values()]);
}

/**
 * A session record as the store wrote it (superjson, with its dates as ISO
 * strings), when its id is one the store would take back.
 */
function storedSession(blob: null | Uint8Array): StoredSession | undefined {
  try {
    const parsed: unknown = JSON.parse(textOf(blob));
    if (!isRecord(parsed) || !isRecord(parsed.json)) {
      return undefined;
    }
    const { createdAt, id, parentId, title, updatedAt } = parsed.json;
    const sessionId = StoreId.SessionSchema.safeParse(id);
    if (!sessionId.success) {
      return undefined;
    }
    return {
      ...(typeof createdAt === "string" ? { createdAt } : {}),
      id: sessionId.data,
      ...(typeof parentId === "string" ? { parentId } : {}),
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof updatedAt === "string" ? { updatedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

function textOf(blob: null | Uint8Array): string {
  return blob ? Buffer.from(blob).toString("utf8") : "";
}

function validDate(value: string | undefined): Date | undefined {
  const date = value === undefined ? undefined : new Date(value);
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** The window records every chat is created beside: the conversation records that are not a chat's. */
function windowRecordIds(tasksDir: string): string[] {
  return readDirs(tasksDir).filter((entry) => {
    const settings = readJson(
      path.join(
        tasksDir,
        entry,
        TASK_PRIVATE_FOLDER_NAME,
        TASK_SETTINGS_FILE_NAME,
      ),
    );
    return (
      settings?.kind === "chat" && typeof settings.chatSessionId !== "string"
    );
  });
}

/**
 * One chat's record. Its settings come first, naming the session it holds, so
 * a rerun after a crash finds this chat rather than making a second; then its
 * rows, inserted or ignored, in one transaction. The settings take the
 * session's title and dates, the model the conversation last ran on, and the
 * folders the conversation held.
 */
function writeChat({
  chatDir,
  rows,
  session,
  windowSettings,
  windowState,
}: {
  chatDir: string;
  rows: StoreRow[];
  session: StoredSession;
  windowSettings: Record<string, unknown>;
  windowState: Record<string, unknown>;
}) {
  const privateDir = path.join(chatDir, TASK_PRIVATE_FOLDER_NAME);
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(path.join(chatDir, TASK_FOLDER_NAMES.attachments), {
    recursive: true,
  });

  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  if (!fs.existsSync(settingsPath)) {
    const createdAt = session.createdAt ?? new Date().toISOString();
    writeJsonFileSync(settingsPath, {
      chatSessionId: session.id,
      createdAt,
      ...(typeof windowSettings.createdWithAppVersion === "string"
        ? { createdWithAppVersion: windowSettings.createdWithAppVersion }
        : {}),
      kind: "chat",
      lastActivityAt: session.updatedAt ?? createdAt,
      name: session.title ?? "Instrument",
      state: Object.fromEntries(
        ["appGuidesRead", "attachedFolders", "selectedModelURI"].flatMap(
          (key) =>
            windowState[key] === undefined ? [] : [[key, windowState[key]]],
        ),
      ),
    });
  }

  const db = new DatabaseSync(path.join(privateDir, TASK_DB_FILE_NAME));
  try {
    db.exec(STORE_SCHEMA);
    const insert = db.prepare(
      "insert or ignore into sessions (key, value, blob, created_at, updated_at) values (?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const row of rows) {
        insert.run(
          row.key,
          row.value,
          row.blob,
          row.created_at,
          row.updated_at,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * The topics become files beside the chats that carry them. Returns how many
 * were written, and how many could not be.
 */
function writeTopics(
  rootDir: string,
  state: Record<string, unknown>,
): { left: number; written: number } {
  let left = 0;
  let written = 0;
  for (const topic of Array.isArray(state.topics) ? state.topics : []) {
    if (
      !isRecord(topic) ||
      typeof topic.id !== "string" ||
      typeof topic.name !== "string"
    ) {
      continue;
    }
    const existing = readTopicsSync(rootDir);
    if (existing.some((entry) => entry.id === topic.id)) {
      continue;
    }
    const content: Topic = {
      ...(typeof topic.about === "string" ? { about: topic.about } : {}),
      ...(typeof topic.color === "string" ? { color: topic.color } : {}),
      createdAt:
        typeof topic.createdAt === "number" ? topic.createdAt : Date.now(),
      ...(typeof topic.emoji === "string" ? { emoji: topic.emoji } : {}),
      id: topic.id,
      name: unusedTopicName(
        topic.name,
        existing.map((entry) => entry.name),
      ),
      ...(topic.retired === true ? { retired: true } : {}),
    };
    try {
      writeTopicSync(rootDir, content);
      written += 1;
    } catch {
      left += 1;
    }
  }
  return { left, written };
}
