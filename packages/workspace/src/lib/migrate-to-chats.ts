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
import { chatIdOf, isChatId } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { serializeTopic, type Topic } from "./orchestrator/topics";
import { forgetRecordFolders } from "./record-folders";
import { writeJsonFileSync } from "./write-json-file-sync";

// Presence = the workspace's chats have their own folders. Written once every
// window record has been migrated, so a run a crash cut short runs again.
const CHATS_MIGRATED_MARKER_NAME = ".chats-migrated";

// Where the window record's settings and database are kept as they were before
// the move, for a release, so a migration that went wrong can be undone by hand.
const BACKUP_DIR_NAME = ".pre-chats";

// Keys of the window's state that only the one-conversation layout used: which
// thread or channel filed a task, the channels themselves, the topics (now
// files), and a draft the window keeps in its own storage.
const RETIRED_STATE_KEYS = new Set([
  "appChannels",
  "channels",
  "promptDraft",
  "taskChannels",
  "taskThreads",
  "topics",
]);

const STORE_SCHEMA = `CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        value TEXT,
        blob BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;

export interface ChatsMigration {
  chatCount: number;
  movedTaskCount: number;
  topicCount: number;
}

interface StoredSession {
  createdAt?: string;
  id: string;
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
 * chat. Each top-level session of the window's record becomes
 * `chats/chat-<ulid>/`, its rows copied into a database of its own; each task
 * a thread or a channel started moves into that chat's `tasks/` with the chat
 * as its parent; the topics become files; and the window keeps only what is
 * the window's. Synchronous and file-level, like the rest of the boot
 * migration: no store is open yet.
 *
 * Idempotent step by step, so a run a crash cut short finishes on the next
 * boot: a chat whose record exists keeps it, rows already copied are not
 * copied twice, a task already moved is not found at its old place.
 */
export function migrateToChats(rootDir: string): ChatsMigration {
  const migration: ChatsMigration = {
    chatCount: 0,
    movedTaskCount: 0,
    topicCount: 0,
  };
  const marker = path.join(
    rootDir,
    TASK_PRIVATE_FOLDER_NAME,
    CHATS_MIGRATED_MARKER_NAME,
  );
  if (fs.existsSync(marker)) {
    return migration;
  }
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  for (const windowId of windowRecordIds(tasksDir)) {
    const moved = migrateWindow(rootDir, windowId);
    migration.chatCount += moved.chatCount;
    migration.movedTaskCount += moved.movedTaskCount;
    migration.topicCount += moved.topicCount;
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "");
  forgetRecordFolders();
  return migration;
}

/** The chat a file in the window's attachments was sent in: the first whose messages name it. */
function chatNaming(
  fileName: string,
  groups: Map<string, StoreRow[]>,
): string | undefined {
  for (const [sessionId, rows] of groups) {
    if (
      rows.some(
        (row) =>
          row.key.startsWith("parts:") && textOf(row.blob).includes(fileName),
      )
    ) {
      return sessionId;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateWindow(rootDir: string, windowId: string): ChatsMigration {
  const migration: ChatsMigration = {
    chatCount: 0,
    movedTaskCount: 0,
    topicCount: 0,
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const windowDir = path.join(tasksDir, windowId);
  const privateDir = path.join(windowDir, TASK_PRIVATE_FOLDER_NAME);
  const backup = path.join(
    rootDir,
    BACKUP_DIR_NAME,
    windowId,
    TASK_PRIVATE_FOLDER_NAME,
  );
  if (!fs.existsSync(backup)) {
    fs.cpSync(privateDir, backup, { recursive: true });
  }

  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  const settings = readJson(settingsPath) ?? {};
  const state = isRecord(settings.state) ? settings.state : {};

  const dbPath = path.join(privateDir, TASK_DB_FILE_NAME);
  const groups = new Map<string, StoreRow[]>();
  const sessions = new Map<string, StoredSession>();
  let globals: StoreRow[] = [];
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    try {
      // node:sqlite types a row as a record of any column value; these are the
      // store's own five columns, as the schema above declares them.
      const rows = db
        .prepare(
          "select key, value, blob, created_at, updated_at from sessions",
        )
        .all() as unknown as StoreRow[];
      for (const row of rows) {
        if (row.key.startsWith("sessions:")) {
          const session = storedSession(row.blob);
          if (session) {
            sessions.set(session.id, session);
          }
        }
      }
      // A session with a parent is a sub-agent's, and goes where its
      // top-level session goes.
      const topOf = (sessionId: string): string | undefined => {
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
      globals = globals.filter((row) => !row.key.startsWith("sessions:"));

      for (const [sessionId, chatRows] of groups) {
        const session = sessions.get(sessionId);
        if (!session || !StoreId.SessionSchema.safeParse(sessionId).success) {
          continue;
        }
        writeChat({
          rootDir,
          rows: [...globals, ...chatRows],
          session,
          windowSettings: settings,
          windowState: state,
        });
        migration.chatCount += 1;
      }
    } finally {
      db.close();
    }
  }

  // Each task a thread or a channel started moves into that chat.
  const filedIn: Record<string, unknown> = {
    ...(isRecord(state.taskChannels) ? state.taskChannels : {}),
    ...(isRecord(state.taskThreads) ? state.taskThreads : {}),
  };
  for (const entry of readDirs(tasksDir)) {
    const taskPrivate = path.join(tasksDir, entry, TASK_PRIVATE_FOLDER_NAME);
    const taskSettingsPath = path.join(taskPrivate, TASK_SETTINGS_FILE_NAME);
    const taskSettings = readJson(taskSettingsPath);
    if (taskSettings?.parentTaskId !== windowId) {
      continue;
    }
    const parsed = StoreId.SessionSchema.safeParse(filedIn[entry]);
    if (!parsed.success) {
      continue;
    }
    const chatId = chatIdOf(parsed.data);
    // Only into a chat that was made, which a rerun finds on disk.
    if (!fs.existsSync(path.join(rootDir, CHATS_DIR_NAME, chatId))) {
      continue;
    }
    const destination = path.join(
      rootDir,
      CHATS_DIR_NAME,
      chatId,
      TASKS_DIR_NAME,
      entry,
    );
    if (fs.existsSync(destination)) {
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeJsonFileSync(taskSettingsPath, {
      ...taskSettings,
      parentTaskId: chatId,
    });
    fs.renameSync(path.join(tasksDir, entry), destination);
    migration.movedTaskCount += 1;
  }

  // A file sent in a chat goes with it.
  const attachmentsDir = path.join(windowDir, TASK_FOLDER_NAMES.attachments);
  for (const fileName of readFiles(attachmentsDir)) {
    const sessionId = chatNaming(fileName, groups);
    const parsed = StoreId.SessionSchema.safeParse(sessionId);
    if (!parsed.success) {
      continue;
    }
    const destination = path.join(
      rootDir,
      CHATS_DIR_NAME,
      chatIdOf(parsed.data),
      TASK_FOLDER_NAMES.attachments,
      fileName,
    );
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(path.join(attachmentsDir, fileName), destination);
    }
  }

  // The topics become files beside the chats that carry them.
  for (const topic of Array.isArray(state.topics) ? state.topics : []) {
    if (!isRecord(topic) || typeof topic.id !== "string") {
      continue;
    }
    const file = path.join(rootDir, TOPICS_DIR_NAME, topic.id, "topic.md");
    if (fs.existsSync(file) || typeof topic.name !== "string") {
      continue;
    }
    const written: Topic = {
      ...(typeof topic.about === "string" ? { about: topic.about } : {}),
      ...(typeof topic.color === "string" ? { color: topic.color } : {}),
      createdAt:
        typeof topic.createdAt === "number" ? topic.createdAt : Date.now(),
      ...(typeof topic.emoji === "string" ? { emoji: topic.emoji } : {}),
      id: topic.id,
      name: topic.name,
      ...(topic.retired === true ? { retired: true } : {}),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeTopic(written), "utf8");
    migration.topicCount += 1;
  }

  // Last, once everything that reads them has: the window keeps the rows that
  // are not a chat's, which are its tabs' browser records and the store's own
  // version.
  if (groups.size > 0) {
    const db = new DatabaseSync(dbPath);
    try {
      const remove = db.prepare("delete from sessions where key = ?");
      for (const rows of groups.values()) {
        for (const row of rows) {
          remove.run(row.key);
        }
      }
    } finally {
      db.close();
    }
  }

  writeJsonFileSync(settingsPath, {
    ...settings,
    state: Object.fromEntries(
      Object.entries(state).filter(([key]) => !RETIRED_STATE_KEYS.has(key)),
    ),
  });
  return migration;
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

/** A session record as the store wrote it: superjson, with its dates as ISO strings. */
function storedSession(blob: null | Uint8Array): StoredSession | undefined {
  try {
    const parsed: unknown = JSON.parse(textOf(blob));
    if (!isRecord(parsed) || !isRecord(parsed.json)) {
      return undefined;
    }
    const { createdAt, id, parentId, title, updatedAt } = parsed.json;
    if (typeof id !== "string") {
      return undefined;
    }
    return {
      ...(typeof createdAt === "string" ? { createdAt } : {}),
      id,
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

/** The window records every chat is created beside: the conversation records that are not a chat's. */
function windowRecordIds(tasksDir: string): string[] {
  return readDirs(tasksDir).filter((entry) => {
    if (isChatId(entry)) {
      return false;
    }
    const settings = readJson(
      path.join(
        tasksDir,
        entry,
        TASK_PRIVATE_FOLDER_NAME,
        TASK_SETTINGS_FILE_NAME,
      ),
    );
    return settings?.kind === "orchestrator";
  });
}

/**
 * One chat's record: its rows in a database of its own, and settings naming
 * it by its session's title, dated by its session, running on the model the
 * conversation last ran on, and holding the folders the conversation held.
 */
function writeChat({
  rootDir,
  rows,
  session,
  windowSettings,
  windowState,
}: {
  rootDir: string;
  rows: StoreRow[];
  session: StoredSession;
  windowSettings: Record<string, unknown>;
  windowState: Record<string, unknown>;
}) {
  const sessionId = StoreId.SessionSchema.parse(session.id);
  const chatDir = path.join(rootDir, CHATS_DIR_NAME, chatIdOf(sessionId));
  const privateDir = path.join(chatDir, TASK_PRIVATE_FOLDER_NAME);
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(path.join(chatDir, TASK_FOLDER_NAMES.attachments), {
    recursive: true,
  });

  const db = new DatabaseSync(path.join(privateDir, TASK_DB_FILE_NAME));
  try {
    db.exec(STORE_SCHEMA);
    const insert = db.prepare(
      "insert or ignore into sessions (key, value, blob, created_at, updated_at) values (?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(row.key, row.value, row.blob, row.created_at, row.updated_at);
    }
  } finally {
    db.close();
  }

  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  if (fs.existsSync(settingsPath)) {
    return;
  }
  const createdAt = session.createdAt ?? new Date().toISOString();
  writeJsonFileSync(settingsPath, {
    createdAt,
    ...(typeof windowSettings.createdWithAppVersion === "string"
      ? { createdWithAppVersion: windowSettings.createdWithAppVersion }
      : {}),
    kind: "orchestrator",
    lastActivityAt: session.updatedAt ?? createdAt,
    name: session.title ?? "Instrument",
    state: Object.fromEntries(
      ["appGuidesRead", "attachedFolders", "selectedModelURI"].flatMap((key) =>
        windowState[key] === undefined ? [] : [[key, windowState[key]]],
      ),
    ),
  });
}
