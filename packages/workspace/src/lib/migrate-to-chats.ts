import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CHATS_DIR_NAME,
  TASK_DB_FILE_NAME,
  TASK_FOLDER_NAMES,
  TASKS_DIR_NAME,
  TOPICS_DIR_NAME,
} from "../constants";
import { StoreId } from "../schemas/store-id";
import { chatFolderName } from "./generate-task-folder-name";
import { serializeTopic, type Topic } from "./orchestrator/topics";
import { forgetRecordFolders } from "./record-folders";
import { writeJsonFileSync } from "./write-json-file-sync";

// Where the window record's settings and database are kept as they were before
// the move, for a release, so a migration that went wrong can be undone by hand.
const BACKUP_DIR_NAME = ".pre-chats";

// Keys of the window's state that only the one-conversation layout used: the
// channels themselves, and a draft the window keeps in its own storage. The
// topics, and the two maps of which chat started which task, are dropped
// separately, and only once everything they name has moved.
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
 * where an item belongs is only let go once the item has moved: a chat's rows
 * leave the window's database only once its own database holds them, and the
 * maps of which chat started which task only once every task in them moved.
 */
export function migrateToChats(rootDir: string): ChatsMigration {
  const migration: ChatsMigration = {
    chatCount: 0,
    leftOver: 0,
    movedTaskCount: 0,
    topicCount: 0,
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const waiting = windowRecordIds(tasksDir).filter((windowId) =>
    holdsOneConversation(path.join(tasksDir, windowId)),
  );
  for (const windowId of waiting) {
    const moved = migrateWindow(rootDir, windowId);
    migration.chatCount += moved.chatCount;
    migration.leftOver += moved.leftOver;
    migration.movedTaskCount += moved.movedTaskCount;
    migration.topicCount += moved.topicCount;
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
 * Whether a chat's rows name a file of the window's by its own name, as a
 * whole path segment, so `a.png` is found neither inside `data.png` nor in
 * `a.png.bak`.
 */
function mentions(rows: StoreRow[], fileName: string): boolean {
  const escaped = fileName.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  const pattern = new RegExp(
    String.raw`(^|[\s/"\\])${escaped}($|[^\w.-])`,
  );
  return rows.some(
    (row) => row.key.startsWith("parts:") && pattern.test(textOf(row.blob)),
  );
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
    if (parsed.success && !chatOf.has(parsed.data) && !failed.has(parsed.data)) {
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
  migration.leftOver += moveFiles({ chatOf, chatsDir, groups, windowDir });
  const topics = writeTopics(rootDir, state);
  migration.topicCount += topics.written;
  migration.leftOver += tasksLeft.left + topics.left;

  // Last, once everything that reads them has: a chat's rows leave the
  // window's database only once its own database holds them, all in one
  // transaction. The window keeps the rest: its tabs' browser records, the
  // store's own version, and any session that could not become a chat.
  if (written.size > 0 && fs.existsSync(dbPath)) {
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
 * A file sent in a chat, a command's output spilled to a file, and a file the
 * agent made or fetched go with the chat that names them: a spill by the id of
 * the part it was written for, any other by its name as a whole path segment.
 * A file more than one chat names stays in the window, since no one chat owns
 * it, and so does anything in a subfolder. Returns how many could not be moved.
 */
function moveFiles({
  chatOf,
  chatsDir,
  groups,
  windowDir,
}: {
  chatOf: Map<StoreId.Session, string>;
  chatsDir: string;
  groups: Map<StoreId.Session, StoreRow[]>;
  windowDir: string;
}): number {
  let left = 0;
  const files = [
    TASK_FOLDER_NAMES.attachments,
    TASK_FOLDER_NAMES.downloads,
    TASK_FOLDER_NAMES.screenshots,
    TASK_FOLDER_NAMES.toolOutput,
    TASK_FOLDER_NAMES.work,
  ].flatMap((dir) =>
    readFiles(path.join(windowDir, dir)).map((name) => ({ dir, name })),
  );
  for (const { dir, name } of files) {
    const partId =
      dir === TASK_FOLDER_NAMES.toolOutput ? name.split(".")[0] : undefined;
    const owners = [...groups].filter(([, rows]) =>
      partId
        ? rows.some((row) => row.key.endsWith(`:${partId}`))
        : mentions(rows, name),
    );
    const owner = owners.length === 1 ? owners[0]?.[0] : undefined;
    const chat = owner ? chatOf.get(owner) : undefined;
    if (!chat) {
      continue;
    }
    const to = path.join(chatsDir, chat, dir, name);
    try {
      if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(windowDir, dir, name), to);
      }
    } catch {
      left += 1;
    }
  }
  return left;
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
      settings?.kind === "orchestrator" &&
      typeof settings.chatSessionId !== "string"
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
      kind: "orchestrator",
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
    const file = path.join(rootDir, TOPICS_DIR_NAME, topic.id, "topic.md");
    if (fs.existsSync(file)) {
      continue;
    }
    const content: Topic = {
      ...(typeof topic.about === "string" ? { about: topic.about } : {}),
      ...(typeof topic.color === "string" ? { color: topic.color } : {}),
      createdAt:
        typeof topic.createdAt === "number" ? topic.createdAt : Date.now(),
      ...(typeof topic.emoji === "string" ? { emoji: topic.emoji } : {}),
      id: topic.id,
      name: topic.name,
      ...(topic.retired === true ? { retired: true } : {}),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, serializeTopic(content), "utf8");
      written += 1;
    } catch {
      left += 1;
    }
  }
  return { left, written };
}
