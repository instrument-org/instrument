import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";
import { ulid } from "ulid";

import {
  CHATS_DIR_NAME,
  TASK_DB_FILE_NAME,
  TASK_FOLDER_NAMES,
  TASKS_DIR_NAME,
} from "../constants";
import { MOUNT } from "../mount-points";
import { RelativePathSchema } from "../schemas/paths";
import { ProjectIdSchema } from "../schemas/project-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { assignMountNames } from "./assign-mount-names";
import { chatFolderName } from "./generate-task-folder-name";
import { translateTaskFolderPaths } from "./orchestrator/mount-paths";
import {
  newTopicId,
  readTopicsSync,
  type Topic,
  type TopicFolder,
  topicName,
  unusedTopicName,
  writeTopicSync,
} from "./orchestrator/topics";
import { forgetRecordFolders } from "./record-folders";
import { isRecord } from "./skills";
import { writeJsonFileSync } from "./write-json-file-sync";

// Where what the move leaves behind is kept, beside the window record's
// backup from the move to chats, so a migration that went wrong can be undone
// by hand: the projects, once their topics are written, and the tasks with
// nothing the user said in them.
const BACKUP_DIR_NAME = ".pre-chats";
const LEGACY_PROJECTS_DIR_NAME = "projects";
const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
const EMPTY_TASKS_DIR_NAME = "empty-tasks";

// The model the tutorial's replay ran on, which marks a task as the tutorial.
const TUTORIAL_MODEL = "tutorial-task-replay";

// The app window's record, as `ensureOrchestrator` names and titles it.
const WINDOW_RECORD_NAME = "instrument";
const WINDOW_RECORD_TITLE = "Instrument";

// A Markdown link or image whose target is a path relative to the task, which
// in a chat has to name the task's folder: not a URL, an anchor, or a path
// from the root.
const RELATIVE_LINK = /(\]\(\s*<?)(?![a-z][\w+.-]*:|[/#?])([^)\s>]+)/gi;

// A leading emoji in a project's folder name, with the space after it: the
// mark 1.x users gave their projects, which a topic keeps as its own mark.
const LEADING_EMOJI =
  /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*)\s*/u;

// A task's files the chat's row lists: what it wrote to hand back, not the
// copies of skills it read, its scratch, or what it installed.
const HELD_FILE_ROOTS = [`${TASK_FOLDER_NAMES.work}/`, "output/"];
const UNHELD_FILE_SEGMENTS = /(?:^|\/)(?:\.[^/]*|node_modules|skills|tmp)\//;

const STORE_SCHEMA = `CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        value TEXT,
        blob BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;

export interface LegacyTasksMigration {
  /** Tasks now inside a chat made for each. */
  adoptedCount: number;
  /**
   * Tasks set aside rather than made into a chat: ones with nothing the user
   * said in them, and the tutorial's replay.
   */
  emptyCount: number;
  /** Tasks and projects that could not be moved this time, and are tried again next boot. */
  leftOver: number;
  /** Topics written for projects that matched none. */
  topicCount: number;
}

interface ConversationMessage {
  createdAt: Date;
  /** The files the user sent with it. */
  files: SessionMessageDataPart.FileAttachmentDataPart[];
  id: StoreId.Message;
  metadata: Record<string, unknown>;
  role: "assistant" | "user";
  /** Its words, part by part. */
  texts: { id: StoreId.Part; text: string }[];
}

interface LegacyProject {
  createdAt: number;
  emoji?: string;
  /** The folders its tasks worked in, which the topic's chats are given. */
  folders: TopicFolder[];
  id: string;
  instructions: string;
  name: string;
  /** Its folder, under `projects/` or already set aside. */
  source: string;
}

interface StoreRow {
  blob: null | Uint8Array;
  key: string;
}

/**
 * Makes every task an earlier version ran on its own into a chat that owns
 * it, and every project into a topic. The chat holds the conversation as the
 * user saw it, their words and the replies, and a note on its first message
 * saying which task did the work; the task moves inside the chat untouched but
 * for naming it as its parent, so a follow-up in the chat reaches the task
 * with its whole history. A project becomes a topic of the same name, or
 * joins the topic already called that, and its instructions become the
 * topic's; the chats of its tasks carry that topic.
 *
 * Runs on every boot and decides from the data, like the move to chats: a
 * task under `tasks/` with no parent that is not a window record is one to
 * adopt, and `projects/` holding a project is one to turn into a topic.
 * Synchronous and file-level, with no store open and no workspace config.
 *
 * A chat is written under a hidden name inside `chats/`, the task moved into
 * it and pointed at it, and only then given its real name, so no chat is ever
 * listed without its task, and a boot cut short part way finishes or discards
 * the chat it left.
 */
export function migrateLegacyTasks(rootDir: string): LegacyTasksMigration {
  const migration: LegacyTasksMigration = {
    adoptedCount: 0,
    emptyCount: 0,
    leftOver: 0,
    topicCount: 0,
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const chatsDir = path.join(rootDir, CHATS_DIR_NAME);
  const staged = finishStagedChats(chatsDir);
  const legacy = readDirs(tasksDir).filter((name) =>
    isLegacyTask(path.join(tasksDir, name)),
  );
  const projectsDir = path.join(rootDir, LEGACY_PROJECTS_DIR_NAME);
  const waitingProjects = readDirs(projectsDir).filter((name) =>
    isProjectFolder(path.join(projectsDir, name)),
  );
  if (legacy.length === 0 && waitingProjects.length === 0 && !staged) {
    return migration;
  }

  const projects = readProjects(rootDir);
  const topicOf = new Map<string, string>();
  const topics = readTopicsSync(rootDir);
  for (const project of projects) {
    try {
      const topic = topicForProject(rootDir, project, topics);
      if (topic.made) {
        migration.topicCount += 1;
      }
      topicOf.set(project.id, topic.id);
    } catch {
      migration.leftOver += 1;
    }
  }

  // Every name in use, so a chat's name is unique across the chats, the tasks
  // inside them, and the tasks no chat owns.
  const taken = new Set([
    ...readDirs(chatsDir),
    ...readDirs(chatsDir).flatMap((chat) =>
      readDirs(path.join(chatsDir, chat, TASKS_DIR_NAME)),
    ),
    ...readDirs(tasksDir),
  ]);
  const folders = grantedFolders(rootDir);
  const seen = new Map<StoreId.Session, StoreId.Message | undefined>();
  const stagedDirs: string[] = [];

  for (const name of legacy) {
    try {
      const adopted = adoptTask({
        chatsDir,
        folders,
        rootDir,
        taken,
        taskDir: path.join(tasksDir, name),
        topicOf,
      });
      if (adopted.kind === "empty") {
        migration.emptyCount += 1;
      } else {
        migration.adoptedCount += 1;
        seen.set(adopted.sessionId, adopted.seen);
        stagedDirs.push(adopted.stagingDir);
      }
    } catch {
      migration.leftOver += 1;
    }
  }

  // Where each chat was last read is written before any of them is listed,
  // so none shows up unread for a moment, or for good if the boot stops here.
  try {
    markSeen(tasksDir, seen);
  } catch {
    // The chats are listed anyway, each with every reply unread, which the
    // user clears by opening it.
  }
  for (const stagingDir of stagedDirs) {
    try {
      finishStagedChat(stagingDir);
    } catch {
      // Left staged, and finished by the next boot.
      migration.leftOver += 1;
    }
  }

  // A project is set aside once its topic is written; one whose topic could
  // not be is left for the next boot.
  for (const name of waitingProjects) {
    const project = projects.find(
      (candidate) => candidate.source === path.join(projectsDir, name),
    );
    if (!project || !topicOf.has(project.id)) {
      continue;
    }
    try {
      moveAside(
        project.source,
        path.join(rootDir, BACKUP_DIR_NAME, LEGACY_PROJECTS_DIR_NAME, name),
      );
    } catch {
      migration.leftOver += 1;
    }
  }
  // Only an empty folder goes: a file the user left beside the projects is
  // theirs, and keeps the folder where it was.
  if (fs.existsSync(projectsDir) && fs.readdirSync(projectsDir).length === 0) {
    fs.rmdirSync(projectsDir);
  }

  forgetRecordFolders();
  return migration;
}

/**
 * One task made into a staged chat, which the caller names once every chat's
 * seen mark is written; or set aside, for the tutorial and a task the user
 * never said anything in. Throws when anything fails, leaving the task where
 * it was and no chat staged.
 */
function adoptTask({
  chatsDir,
  folders,
  rootDir,
  taken,
  taskDir,
  topicOf,
}: {
  chatsDir: string;
  folders: Record<string, unknown>;
  rootDir: string;
  taken: Set<string>;
  taskDir: string;
  topicOf: Map<string, string>;
}):
  | {
      kind: "adopted";
      seen?: StoreId.Message;
      sessionId: StoreId.Session;
      stagingDir: string;
    }
  | { kind: "empty" } {
  const taskName = path.basename(taskDir);
  const taskId = TaskIdSchema.parse(taskName);
  const settingsPath = path.join(
    taskDir,
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );
  const settings = readJson(settingsPath) ?? {};
  const conversation = readConversation(
    path.join(taskDir, TASK_PRIVATE_FOLDER_NAME, TASK_DB_FILE_NAME),
  );
  if (
    conversation.tutorial ||
    !conversation.messages.some((message) => message.role === "user")
  ) {
    moveAside(
      taskDir,
      path.join(rootDir, BACKUP_DIR_NAME, EMPTY_TASKS_DIR_NAME, taskName),
    );
    return { kind: "empty" };
  }

  const firstMessageAt = conversation.messages[0]?.createdAt;
  const createdAt =
    validDate(settings.createdAt) ?? firstMessageAt ?? new Date();
  const lastActivityAt =
    validDate(settings.lastActivityAt) ??
    conversation.messages.at(-1)?.createdAt ??
    createdAt;
  const title =
    (typeof settings.name === "string" && settings.name.trim()) ||
    conversation.title ||
    firstLine(conversation.messages[0]?.texts[0]?.text ?? "") ||
    "Chat";
  const chatName = chatFolderName({
    date: createdAt,
    isTaken: (candidate) => taken.has(candidate),
    title,
  });
  taken.add(chatName);

  const sessionId = StoreId.SessionSchema.parse(
    `ses_${ulid(createdAt.getTime())}`,
  );
  const stagingDir = path.join(chatsDir, stagingName(chatName));
  fs.rmSync(stagingDir, { force: true, recursive: true });
  try {
    const topicId =
      typeof settings.projectId === "string"
        ? topicOf.get(settings.projectId)
        : undefined;
    const pinnedAt = validDate(settings.pinnedAt);
    const session: Session.Type = {
      createdAt,
      id: sessionId,
      ...(pinnedAt ? { starredAt: pinnedAt } : {}),
      title,
      titleSettledAt: createdAt,
      ...(topicId ? { topics: [topicId] } : {}),
      updatedAt: lastActivityAt,
    };
    // The task's own folders too, so a reply naming `/mnt/<folder>/…` reaches
    // the same file from the chat that it did from the task.
    const chatFolders = withTaskFolders(
      folders,
      isRecord(settings.state) ? settings.state.attachedFolders : undefined,
    );
    const privateDir = path.join(stagingDir, TASK_PRIVATE_FOLDER_NAME);
    fs.mkdirSync(privateDir, { recursive: true });
    fs.mkdirSync(path.join(stagingDir, TASK_FOLDER_NAMES.attachments), {
      recursive: true,
    });
    writeJsonFileSync(path.join(privateDir, TASK_SETTINGS_FILE_NAME), {
      chatSessionId: sessionId,
      createdAt: createdAt.toISOString(),
      ...(typeof settings.createdWithAppVersion === "string"
        ? { createdWithAppVersion: settings.createdWithAppVersion }
        : {}),
      kind: "orchestrator",
      lastActivityAt: lastActivityAt.toISOString(),
      name: title,
      state: {
        attachedFolders: chatFolders.folders,
        ...(isRecord(settings.state) &&
        typeof settings.state.selectedModelURI === "string"
          ? { selectedModelURI: settings.state.selectedModelURI }
          : {}),
      },
    });
    copyAttachments(taskDir, stagingDir, conversation.attachments);
    writeChatRows({
      dbPath: path.join(privateDir, TASK_DB_FILE_NAME),
      files: heldFiles(taskDir, taskId, conversation.changedFiles),
      messages: conversation.messages,
      mountRenames: chatFolders.renames,
      session,
      taskId,
    });

    const inside = path.join(stagingDir, TASKS_DIR_NAME, taskName);
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.renameSync(taskDir, inside);
  } catch (error) {
    fs.rmSync(stagingDir, { force: true, recursive: true });
    throw error;
  }
  return {
    kind: "adopted",
    sessionId,
    stagingDir,
    ...seenMark(conversation.messages, settings.unreadIndicator !== undefined),
  };
}

/** Clones the files the user sent from the task into the chat, at the same path. */
function copyAttachments(from: string, to: string, attachments: string[]) {
  for (const relative of attachments) {
    const source = path.join(from, relative);
    const target = path.join(to, relative);
    if (
      !relative.startsWith(`${TASK_FOLDER_NAMES.attachments}/`) ||
      !present(source) ||
      present(target)
    ) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // A clone where the disk can make one, so a chat of photos costs nothing.
    fs.cpSync(source, target, {
      mode: fs.constants.COPYFILE_FICLONE,
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

/**
 * Gives a staged chat its name once the task is inside it, pointing the task
 * at it first; one cut short before its task moved in is discarded, since the
 * task is still under `tasks/` and is adopted again.
 */
function finishStagedChat(stagingDir: string) {
  const chatName = path.basename(stagingDir).slice(1, -".partial".length);
  const inside = path.join(stagingDir, TASKS_DIR_NAME);
  const [taskName] = readDirs(inside);
  if (taskName === undefined) {
    fs.rmSync(stagingDir, { force: true, recursive: true });
    return;
  }
  const taskSettingsPath = path.join(
    inside,
    taskName,
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );
  const { projectId: _projectId, ...taskSettings } =
    readJson(taskSettingsPath) ?? {};
  writeJsonFileSync(taskSettingsPath, {
    ...taskSettings,
    parentTaskId: chatName,
  });
  fs.renameSync(stagingDir, path.join(path.dirname(stagingDir), chatName));
}

/** Finishes the chats an earlier boot staged. Returns whether there were any. */
function finishStagedChats(chatsDir: string): boolean {
  const staged = readDirs(chatsDir).filter(
    (name) => name.startsWith(".") && name.endsWith(".partial"),
  );
  for (const name of staged) {
    try {
      finishStagedChat(path.join(chatsDir, name));
    } catch {
      // Left staged, and tried again on the next boot.
    }
  }
  return staged.length > 0;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 80) ?? ""
  );
}

/**
 * Every folder granted to the window or any chat, one entry per path at the
 * widest access given, named the way a new chat names them: what a chat made
 * today starts with.
 */
function grantedFolders(rootDir: string): Record<string, unknown> {
  const holders = [
    ...readDirs(path.join(rootDir, TASKS_DIR_NAME)).map((name) =>
      path.join(rootDir, TASKS_DIR_NAME, name),
    ),
    ...readDirs(path.join(rootDir, CHATS_DIR_NAME)).map((name) =>
      path.join(rootDir, CHATS_DIR_NAME, name),
    ),
  ];
  const byPath = new Map<string, Record<string, unknown>>();
  for (const holder of holders) {
    const settings = readJson(
      path.join(holder, TASK_PRIVATE_FOLDER_NAME, TASK_SETTINGS_FILE_NAME),
    );
    if (settings?.kind !== "orchestrator" || !isRecord(settings.state)) {
      continue;
    }
    const attached = settings.state.attachedFolders;
    for (const folder of isRecord(attached) ? Object.values(attached) : []) {
      if (
        !isRecord(folder) ||
        typeof folder.path !== "string" ||
        typeof folder.id !== "string" ||
        typeof folder.createdAt !== "number"
      ) {
        continue;
      }
      const known = byPath.get(folder.path);
      if (
        !known ||
        (known.access === "read-only" && folder.access !== "read-only")
      ) {
        byPath.set(folder.path, folder);
      }
    }
  }
  const sorted = [...byPath.values()].toSorted(
    (a, b) => Number(a.createdAt) - Number(b.createdAt),
  );
  const names = assignMountNames(
    sorted.map((folder) => ({
      id: String(folder.id),
      path: String(folder.path),
    })),
  );
  return Object.fromEntries(
    sorted.map((folder) => {
      const mountName =
        names.get(String(folder.id)) ?? String(folder.mountName ?? folder.id);
      return [mountName, { ...folder, mountName }];
    }),
  );
}

/**
 * The files the task made that are still there, as the chat reaches them:
 * what its turns recorded writing, newest last, less what they deleted, the
 * skills they copied in, and scratch.
 */
function heldFiles(
  taskDir: string,
  taskId: string,
  changed: { filePath: string; status: string }[],
): string[] {
  const kept = new Set<string>();
  for (const { filePath, status } of changed) {
    kept.delete(filePath);
    if (status !== "deleted") {
      kept.add(filePath);
    }
  }
  return [...kept]
    .filter(
      (filePath) =>
        HELD_FILE_ROOTS.some((root) => filePath.startsWith(root)) &&
        !UNHELD_FILE_SEGMENTS.test(filePath) &&
        present(path.join(taskDir, filePath)),
    )
    .map((filePath) => `${MOUNT.tasks}/${taskId}/${filePath}`);
}

/**
 * A task no chat owns and that is no chat: one an earlier version ran on its
 * own. Not a window record, a chat's record, or a project folder that ended up
 * among the tasks.
 */
function isLegacyTask(taskDir: string): boolean {
  if (!TaskIdSchema.safeParse(path.basename(taskDir)).success) {
    return false;
  }
  const privateDir = path.join(taskDir, TASK_PRIVATE_FOLDER_NAME);
  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  // The earliest builds could leave a task with a database and no settings
  // yet, which is a task like any other. Settings that cannot be read are
  // left alone.
  const settings = present(settingsPath)
    ? readJson(settingsPath)
    : present(path.join(privateDir, TASK_DB_FILE_NAME))
      ? {}
      : undefined;
  return (
    settings !== undefined &&
    (settings.kind === undefined || settings.kind === "task") &&
    settings.parentTaskId === undefined &&
    settings.chatSessionId === undefined &&
    !ProjectIdSchema.safeParse(settings.id).success
  );
}

function isProjectFolder(folder: string): boolean {
  const settings = readJson(
    path.join(folder, TASK_PRIVATE_FOLDER_NAME, TASK_SETTINGS_FILE_NAME),
  );
  return ProjectIdSchema.safeParse(settings?.id).success;
}

/**
 * Writes where each adopted chat was last read onto the window records, so a
 * chat reads as unread only where its task did. Merged into what each window
 * already holds, and a chat whose task read as unread gets no mark, or one
 * short of its newest reply, the way marking a chat unread leaves it.
 */
function markSeen(
  tasksDir: string,
  seen: Map<StoreId.Session, StoreId.Message | undefined>,
) {
  if (seen.size === 0) {
    return;
  }
  const windows = readDirs(tasksDir).filter((name) => {
    const settings = readJson(
      path.join(
        tasksDir,
        name,
        TASK_PRIVATE_FOLDER_NAME,
        TASK_SETTINGS_FILE_NAME,
      ),
    );
    return (
      settings?.kind === "orchestrator" && settings.chatSessionId === undefined
    );
  });
  // A 1.x user who never opened the app window has no record for it yet, and
  // the marks would have nowhere to go. It is made the way the app would first
  // make it, and the app takes it as the window's.
  if (
    windows.length === 0 &&
    !present(path.join(tasksDir, WINDOW_RECORD_NAME))
  ) {
    const windowPrivateDir = path.join(
      tasksDir,
      WINDOW_RECORD_NAME,
      TASK_PRIVATE_FOLDER_NAME,
    );
    fs.mkdirSync(windowPrivateDir, { recursive: true });
    writeJsonFileSync(path.join(windowPrivateDir, TASK_SETTINGS_FILE_NAME), {
      createdAt: new Date().toISOString(),
      kind: "orchestrator",
      name: WINDOW_RECORD_TITLE,
    });
    windows.push(WINDOW_RECORD_NAME);
  }
  for (const name of windows) {
    const settingsPath = path.join(
      tasksDir,
      name,
      TASK_PRIVATE_FOLDER_NAME,
      TASK_SETTINGS_FILE_NAME,
    );
    const settings = readJson(settingsPath) ?? {};
    const state = isRecord(settings.state) ? settings.state : {};
    const marks = new Map<string, unknown>(
      Object.entries(isRecord(state.chatSeen) ? state.chatSeen : {}),
    );
    for (const [sessionId, messageId] of seen) {
      if (messageId === undefined) {
        marks.delete(sessionId);
      } else {
        marks.set(sessionId, messageId);
      }
    }
    const chatSeen = Object.fromEntries(marks);
    writeJsonFileSync(settingsPath, {
      ...settings,
      state: { ...state, chatSeen },
    });
  }
}

/** Moves a folder into the backup, beside any earlier one of the same name. */
function moveAside(source: string, to: string) {
  let target = to;
  for (let suffix = 2; present(target); suffix += 1) {
    target = `${to}-${suffix}`;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

/** A name without its leading emoji, as a topic's name is compared. */
function nameKey(name: string): string {
  return topicName(name.replace(LEADING_EMOJI, "")).toLowerCase();
}

function present(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A project's folders as a topic holds them: by path, a 1.x project having
 * stored either the bare path or the path with its access, which a topic's
 * folders no longer carry.
 */
function projectFolders(raw: unknown): TopicFolder[] {
  return (Array.isArray(raw) ? raw : []).flatMap((folder): TopicFolder[] => {
    const folderPath =
      typeof folder === "string"
        ? folder
        : isRecord(folder) && typeof folder.path === "string"
          ? folder.path
          : undefined;
    return folderPath ? [{ path: folderPath }] : [];
  });
}

/**
 * What the user saw of a task: every top-level session in the order they
 * began, each message in order, the user's words and files and the replies'
 * words, and nothing else. Also which files the user sent, and which its
 * turns recorded changing.
 */
function readConversation(dbPath: string): {
  attachments: string[];
  changedFiles: { filePath: string; status: string }[];
  messages: ConversationMessage[];
  title?: string;
  /** Whether it is the tutorial's replay, which a chat is not made for. */
  tutorial: boolean;
} {
  const attachments: string[] = [];
  const changedFiles: { filePath: string; status: string }[] = [];
  const messages: ConversationMessage[] = [];
  if (!fs.existsSync(dbPath)) {
    return { attachments, changedFiles, messages, tutorial: false };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows: StoreRow[];
  try {
    // node:sqlite types a row as a record of any column value; these are two
    // of the store's own columns.
    rows = db
      .prepare(
        "select key, blob from sessions where key like 'sessions:%' or key like 'messages:%' or key like 'parts:%'",
      )
      .all() as unknown as StoreRow[];
  } finally {
    db.close();
  }

  const sessions: { createdAt: string; id: string; title?: string }[] = [];
  const messageRows = new Map<string, Record<string, unknown>>();
  const partRows = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const value = storedValue(row.blob);
    if (!isRecord(value)) {
      continue;
    }
    const [kind, , messageId] = row.key.split(":");
    if (kind === "sessions") {
      if (typeof value.id === "string" && value.parentId === undefined) {
        sessions.push({
          createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
          id: value.id,
          ...(typeof value.title === "string" ? { title: value.title } : {}),
        });
      }
    } else if (kind === "messages" && messageId) {
      messageRows.set(messageId, value);
    } else if (kind === "parts" && messageId) {
      partRows.set(messageId, [...(partRows.get(messageId) ?? []), value]);
    }
  }

  const sessionOrder = sessions
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((session) => session.id);
  const sessionOf = (message: Record<string, unknown>) =>
    isRecord(message.metadata) ? message.metadata.sessionId : undefined;
  // By id alone, the order the chat reads its messages in, so sessions that
  // overlapped in time interleave rather than one following the other.
  const ordered = [...messageRows.entries()]
    .filter(([, message]) => sessionOrder.includes(String(sessionOf(message))))
    .toSorted(([a], [b]) => a.localeCompare(b));

  let tutorial = false;
  for (const [messageId, message] of ordered) {
    const parts = (partRows.get(messageId) ?? []).toSorted((a, b) =>
      String(isRecord(a.metadata) ? a.metadata.id : "").localeCompare(
        String(isRecord(b.metadata) ? b.metadata.id : ""),
      ),
    );
    for (const part of parts) {
      if (part.type === "data-fileChanges" && isRecord(part.data)) {
        for (const file of Array.isArray(part.data.files)
          ? part.data.files
          : []) {
          if (
            isRecord(file) &&
            typeof file.filePath === "string" &&
            typeof file.status === "string"
          ) {
            changedFiles.push({ filePath: file.filePath, status: file.status });
          }
        }
      }
    }
    const role = message.role;
    const id = StoreId.MessageSchema.safeParse(messageId);
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const createdAt = validDate(metadata.createdAt);
    if (
      role === "assistant" &&
      String(metadata.providerId ?? metadata.modelId).includes(TUTORIAL_MODEL)
    ) {
      tutorial = true;
    }
    if (
      (role !== "user" && role !== "assistant") ||
      !id.success ||
      !createdAt
    ) {
      continue;
    }
    const texts = parts.filter(
      (part): part is Record<string, unknown> & { text: string } =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim() !== "",
    );
    const sent =
      role === "user"
        ? parts.find(
            (part) =>
              part.type === "data-attachments" &&
              isRecord(part.data) &&
              Array.isArray(part.data.files) &&
              part.data.files.length > 0,
          )
        : undefined;
    if (texts.length === 0 && !sent) {
      continue;
    }
    const sentFiles =
      sent && isRecord(sent.data) && Array.isArray(sent.data.files)
        ? sent.data.files.flatMap((file) => {
            const filePath = RelativePathSchema.safeParse(
              isRecord(file) ? file.filePath : undefined,
            );
            return isRecord(file) &&
              filePath.success &&
              typeof file.filename === "string" &&
              typeof file.mimeType === "string" &&
              typeof file.size === "number"
              ? [
                  {
                    filename: file.filename,
                    filePath: filePath.data,
                    mimeType: file.mimeType,
                    modifiedAt:
                      typeof file.modifiedAt === "number" ? file.modifiedAt : 0,
                    size: file.size,
                  },
                ]
              : [];
          })
        : [];
    attachments.push(...sentFiles.map((file) => file.filePath));
    messages.push({
      createdAt,
      files: sentFiles,
      id: id.data,
      metadata,
      role,
      texts: texts.flatMap((part) => {
        const partId = StoreId.PartSchema.safeParse(
          isRecord(part.metadata) ? part.metadata.id : undefined,
        );
        return partId.success ? [{ id: partId.data, text: part.text }] : [];
      }),
    });
  }
  const title = sessions.find(
    (session) => session.id === sessionOrder[0],
  )?.title;
  return {
    attachments,
    changedFiles,
    messages,
    ...(title ? { title } : {}),
    tutorial,
  };
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

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every project, waiting under `projects/` or already set aside by an earlier
 * boot, so a task a later boot adopts still finds its project's topic.
 */
function readProjects(rootDir: string): LegacyProject[] {
  const dirs = [
    path.join(rootDir, LEGACY_PROJECTS_DIR_NAME),
    path.join(rootDir, BACKUP_DIR_NAME, LEGACY_PROJECTS_DIR_NAME),
  ];
  return dirs.flatMap((dir) =>
    readDirs(dir).flatMap((name): LegacyProject[] => {
      const source = path.join(dir, name);
      const settings = readJson(
        path.join(source, TASK_PRIVATE_FOLDER_NAME, TASK_SETTINGS_FILE_NAME),
      );
      const id = ProjectIdSchema.safeParse(settings?.id);
      if (!id.success) {
        return [];
      }
      let instructions = "";
      try {
        instructions = fs
          .readFileSync(
            path.join(source, PROJECT_INSTRUCTIONS_FILE_NAME),
            "utf8",
          )
          .trim();
      } catch {
        // No instructions: most projects had none.
      }
      const emoji = LEADING_EMOJI.exec(name)?.[1];
      const bare = topicName(name.replace(LEADING_EMOJI, "")) || name;
      return [
        {
          createdAt:
            validDate(settings?.createdAt)?.getTime() ??
            fs.statSync(source).birthtimeMs,
          ...(emoji ? { emoji } : {}),
          folders: projectFolders(settings?.folders),
          id: id.data,
          instructions,
          name: bare,
          source,
        },
      ];
    }),
  );
}

/** The text with each `/mnt/<old>/` a chat knows by another name spelled that way. */
function renameMounts(text: string, renames: Map<string, string>): string {
  let renamed = text;
  for (const [from, to] of renames) {
    renamed = renamed.replaceAll(
      `${MOUNT.attachedFolders}/${from}/`,
      `${MOUNT.attachedFolders}/${to}/`,
    );
  }
  return renamed;
}

/**
 * Where a chat was last read: its newest message for a task the user had
 * seen, or the message before its newest reply for one marked unread, so
 * that reply alone counts. None when nothing comes before that reply.
 */
function seenMark(
  messages: ConversationMessage[],
  unread: boolean,
): { seen?: StoreId.Message } {
  const newest = messages.at(-1);
  if (!unread) {
    return newest ? { seen: newest.id } : {};
  }
  const reply = messages.findLastIndex(
    (message) => message.role === "assistant",
  );
  const before = reply > 0 ? messages[reply - 1] : undefined;
  return before ? { seen: before.id } : {};
}

/** The hidden name a chat is written under until its task is inside it. */
function stagingName(chatName: string): string {
  return `.${chatName}.partial`;
}

function storedValue(blob: null | Uint8Array): unknown {
  if (!blob) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(blob).toString("utf8"));
    return isRecord(parsed) ? parsed.json : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The topic a project's chats carry: the one already called by its name, with
 * the project's instructions added after its own and its folders beside them,
 * or a new one made from it. Asking again for the same project changes
 * nothing, since what it would add is already there.
 */
function topicForProject(
  rootDir: string,
  project: LegacyProject,
  topics: Topic[],
): { id: string; made: boolean } {
  // Its own topic first, from an earlier boot. Otherwise one of the user's of
  // the same name, never another project's: names are cut to a topic's
  // length, so two long project names can meet.
  const own = topics.findIndex((topic) => topic.projectId === project.id);
  const index =
    own === -1
      ? topics.findIndex(
          (topic) =>
            topic.projectId === undefined &&
            !topic.retired &&
            nameKey(topic.name) === nameKey(project.name),
        )
      : own;
  const existing = topics[index];
  if (existing) {
    const held = new Set((existing.folders ?? []).map((folder) => folder.path));
    const added = project.folders.filter((folder) => !held.has(folder.path));
    const body = existing.instructions?.trim() ?? "";
    const addsInstructions =
      project.instructions !== "" && !body.includes(project.instructions);
    if (added.length > 0 || addsInstructions || own === -1) {
      const next: Topic = {
        ...existing,
        projectId: existing.projectId ?? project.id,
        ...(added.length > 0
          ? { folders: [...(existing.folders ?? []), ...added] }
          : {}),
        ...(addsInstructions
          ? {
              instructions: body
                ? `${body}\n\n${project.instructions}`
                : project.instructions,
            }
          : {}),
      };
      writeTopicSync(rootDir, next);
      topics[index] = next;
    }
    return { id: existing.id, made: false };
  }
  const topic: Topic = {
    createdAt: project.createdAt,
    ...(project.emoji ? { emoji: project.emoji } : {}),
    ...(project.folders.length > 0 ? { folders: project.folders } : {}),
    id: newTopicId(project.createdAt),
    ...(project.instructions ? { instructions: project.instructions } : {}),
    name: unusedTopicName(
      project.name,
      topics.map((known) => known.name),
    ),
    projectId: project.id,
  };
  writeTopicSync(rootDir, topic);
  topics.push(topic);
  return { id: topic.id, made: true };
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The chat's folders with the task's added: a folder the chat already has by
 * path is kept under the chat's name for it, and a new one takes the task's
 * name, or the next free one when the chat already uses that name for another
 * folder. Returns the names that differ, so the copied replies can be spelled
 * the way the chat reaches them. A folder a project lent the task is the
 * chat's own from here, since the project it came from is gone.
 */
function withTaskFolders(
  chatFolders: Record<string, unknown>,
  taskFolders: unknown,
): { folders: Record<string, unknown>; renames: Map<string, string> } {
  const folders: Record<string, unknown> = { ...chatFolders };
  const renames = new Map<string, string>();
  for (const [key, folder] of Object.entries(
    isRecord(taskFolders) ? taskFolders : {},
  )) {
    if (!isRecord(folder) || typeof folder.path !== "string") {
      continue;
    }
    const taskName =
      typeof folder.mountName === "string" ? folder.mountName : key;
    const known = Object.entries(folders).find(
      ([, existing]) => isRecord(existing) && existing.path === folder.path,
    );
    if (known) {
      if (known[0] !== taskName) {
        renames.set(taskName, known[0]);
      }
      continue;
    }
    let name = taskName;
    for (let suffix = 2; name in folders; suffix += 1) {
      name = `${taskName}-${suffix}`;
    }
    folders[name] = { ...folder, mountName: name, source: "user" };
    if (name !== taskName) {
      renames.set(taskName, name);
    }
  }
  return { folders, renames };
}

/**
 * The chat's database: its session, then each message and its parts, in one
 * transaction. The replies' task paths are rewritten to where the chat reaches
 * the task's folder, and the first message carries the note on the task.
 */
function writeChatRows({
  dbPath,
  files,
  messages,
  mountRenames,
  session,
  taskId,
}: {
  dbPath: string;
  files: string[];
  messages: ConversationMessage[];
  /** Mount names the chat knows a task's folder by, where they differ from the task's. */
  mountRenames: Map<string, string>;
  session: Session.Type;
  taskId: ReturnType<typeof TaskIdSchema.parse>;
}) {
  const rows: [string, unknown][] = [[`sessions:${session.id}`, session]];
  let adopted = false;
  for (const message of messages) {
    const stored: SessionMessage.Type =
      message.role === "user"
        ? {
            id: message.id,
            metadata: { createdAt: message.createdAt, sessionId: session.id },
            role: "user",
          }
        : {
            id: message.id,
            metadata: {
              createdAt: message.createdAt,
              finishedAt: message.createdAt,
              finishReason: "stop",
              modelId:
                typeof message.metadata.modelId === "string"
                  ? message.metadata.modelId
                  : "unknown",
              providerId:
                typeof message.metadata.providerId === "string"
                  ? message.metadata.providerId
                  : "unknown",
              sessionId: session.id,
            },
            role: "assistant",
          };
    rows.push([`messages:${session.id}:${message.id}`, stored]);
    const metadata = () => ({
      createdAt: message.createdAt,
      id: StoreId.newPartId(),
      messageId: message.id,
      sessionId: session.id,
    });
    const parts: SessionMessagePart.Type[] = message.texts.map((part) => ({
      metadata: { ...metadata(), endedAt: message.createdAt, id: part.id },
      state: "done",
      text:
        message.role === "assistant"
          ? renameMounts(
              translateTaskFolderPaths(part.text, taskId),
              mountRenames,
            ).replaceAll(
              RELATIVE_LINK,
              (_match, open: string, target: string) =>
                `${open}${MOUNT.tasks}/${taskId}/${target.replace(/^\.\//, "")}`,
            )
          : part.text,
      type: "text",
    }));
    if (message.files.length > 0) {
      parts.push({
        data: { files: message.files },
        metadata: metadata(),
        type: "data-attachments",
      });
    }
    if (message.role === "user" && !adopted) {
      adopted = true;
      parts.push({
        data: { files, taskId },
        metadata: metadata(),
        type: "data-adoptedTask",
      });
    }
    for (const part of parts) {
      rows.push([
        `parts:${session.id}:${message.id}:${part.metadata.id}`,
        part,
      ]);
    }
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(STORE_SCHEMA);
    const insert = db.prepare(
      "insert or replace into sessions (key, blob) values (?, ?)",
    );
    db.exec("BEGIN");
    try {
      for (const [key, value] of rows) {
        // As text: the store reads a row back as a string or not at all.
        insert.run(key, superjson.stringify(value));
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
