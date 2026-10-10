import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ulid } from "ulid";

import {
  CHATS_DIR_NAME,
  TASK_DB_FILE_NAME,
  TASK_FOLDER_NAMES,
  TASKS_DIR_NAME,
} from "../constants";
import { RelativePathSchema } from "../schemas/paths";
import { ProjectIdSchema } from "../schemas/project-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { chatFolderName } from "./generate-task-folder-name";
import {
  newTopicId,
  readTopicsSync,
  type Topic,
  type TopicFolder,
  topicName,
  unusedTopicName,
  writeTopicSync,
} from "./chat/topics";
import { forgetChatFolders } from "./record-folders";
import { isRecord } from "./skills";
import { STORE_TABLE, writeStoreRowsSync } from "./store-table";
import { StorageKey } from "./storage-key";

// Where what the move leaves behind is kept, so a migration that went wrong
// can be undone by hand: the projects, once their topics are written, the
// tasks with nothing the user said in them, and each chat's 1.x settings and
// database as the task had them.
const BACKUP_DIR_NAME = ".pre-chats";
const LEGACY_PROJECTS_DIR_NAME = "projects";
const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
const EMPTY_TASKS_DIR_NAME = "empty-tasks";
const TASK_RECORDS_DIR_NAME = "task-records";

// What a task carries while it is staged as a chat: the chat's database and
// settings, written beside the task's own and put in their place once the
// folder is among the chats.
const CHAT_DB_FILE_NAME = ".chat.db";
const CHAT_SETTINGS_FILE_NAME = ".chat-settings.json";

// SQLite keeps sidecar files next to a database; they travel with it.
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

// The model the tutorial's replay ran on, which marks a task as the tutorial.
const TUTORIAL_MODEL = "tutorial-task-replay";

// A leading emoji in a project's folder name, with the space after it: the
// mark 1.x users gave their projects, which a topic keeps as its own mark.
const LEADING_EMOJI =
  /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*)\s*/u;

export interface LegacyTasksMigration {
  /** Tasks made into chats. */
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
 * Makes every task an earlier version ran on its own into a chat, and every
 * project into a topic. The task's folder becomes the chat's, files and all,
 * so a path its replies named is the same path in the chat; its database is
 * rewritten as the chat's one conversation, holding what the user saw (their
 * words and files, and the replies) under the ids they had. A project becomes
 * a topic of the same name, or joins the topic already called that, and its
 * instructions become the topic's; the chats of its tasks carry that topic.
 *
 * Runs with the layout sweep in `migrateWorkspaceLayout`, once per layout
 * version, and decides from the data: a task under `tasks/` that no chat
 * started is one to adopt, and `projects/` holding a project is one to turn
 * into a topic.
 * Synchronous and file-level, with no store open and no workspace config.
 *
 * The chat's database and settings are written beside the task's own, the
 * folder moved among the chats under a hidden name, the task's files set
 * aside for the chat's, and only then the folder given its real name, so no
 * chat is listed half made, and a boot cut short part way finishes the chat
 * it left.
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
  const staged = finishStagedChats(chatsDir, rootDir);
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
  const stagedDirs: string[] = [];

  for (const name of legacy) {
    try {
      const adopted = adoptTask({
        chatsDir,
        rootDir,
        taken,
        chatDir: path.join(tasksDir, name),
        topicOf,
      });
      if (adopted.kind === "empty") {
        migration.emptyCount += 1;
      } else {
        migration.adoptedCount += 1;
        stagedDirs.push(adopted.stagingDir);
      }
    } catch {
      migration.leftOver += 1;
    }
  }

  for (const stagingDir of stagedDirs) {
    try {
      finishStagedChat(stagingDir, rootDir);
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

  forgetChatFolders();
  return migration;
}

/**
 * One task made into a staged chat, which the caller names once every task
 * has been staged; or set aside, for the tutorial and a task the user
 * never said anything in. Throws when anything fails, leaving the task where
 * it was and no chat staged.
 */
function adoptTask({
  chatsDir,
  rootDir,
  taken,
  chatDir,
  topicOf,
}: {
  chatsDir: string;
  rootDir: string;
  taken: Set<string>;
  chatDir: string;
  topicOf: Map<string, string>;
}):
  | {
      /** The chat's id, the folder it lands in once staged. */
      chatId: string;
      kind: "adopted";
      stagingDir: string;
    }
  | { kind: "empty" } {
  const taskName = path.basename(chatDir);
  const privateDir = path.join(chatDir, TASK_PRIVATE_FOLDER_NAME);
  const settings =
    readJson(path.join(privateDir, TASK_SETTINGS_FILE_NAME)) ?? {};
  const conversation = readConversation(
    path.join(privateDir, TASK_DB_FILE_NAME),
  );
  if (
    conversation.tutorial ||
    !conversation.messages.some((message) => message.role === "user")
  ) {
    moveAside(
      chatDir,
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
  const topicId =
    typeof settings.projectId === "string"
      ? topicOf.get(settings.projectId)
      : undefined;
  const pinnedAt = validDate(settings.pinnedAt);
  // A task left unread is a chat left unread, a mark the user put on it
  // staying theirs.
  const unread = isRecord(settings.unreadIndicator)
    ? settings.unreadIndicator
    : undefined;
  const session: Session.Type = {
    createdAt,
    id: sessionId,
    ...(pinnedAt ? { starredAt: pinnedAt } : {}),
    ...(unread
      ? {
          unreadAt: lastActivityAt,
          ...(unread.manual === true ? { unreadByUser: true } : {}),
        }
      : {}),
    title,
    titleSettledAt: createdAt,
    ...(topicId ? { topics: [topicId] } : {}),
    updatedAt: lastActivityAt,
  };

  const chatDb = path.join(privateDir, CHAT_DB_FILE_NAME);
  const chatSettings = path.join(privateDir, CHAT_SETTINGS_FILE_NAME);
  const stagingDir = path.join(chatsDir, stagingName(chatName));
  fs.rmSync(stagingDir, { force: true, recursive: true });
  try {
    removeDb(chatDb);
    writeChatRows({ dbPath: chatDb, messages: conversation.messages, session });
    fs.writeFileSync(
      chatSettings,
      JSON.stringify({
        chatSessionId: sessionId,
        createdAt: createdAt.toISOString(),
        ...(typeof settings.createdWithAppVersion === "string"
          ? { createdWithAppVersion: settings.createdWithAppVersion }
          : {}),
        lastActivityAt: lastActivityAt.toISOString(),
        name: title,
        state: {
          attachedFolders: chatFoldersOf(
            isRecord(settings.state)
              ? settings.state.attachedFolders
              : undefined,
          ),
          ...(isRecord(settings.state) &&
          typeof settings.state.selectedModelURI === "string"
            ? { selectedModelURI: settings.state.selectedModelURI }
            : {}),
        },
      }),
    );
    fs.mkdirSync(path.join(chatDir, TASK_FOLDER_NAMES.attachments), {
      recursive: true,
    });
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.renameSync(chatDir, stagingDir);
  } catch (error) {
    removeDb(chatDb);
    fs.rmSync(chatSettings, { force: true });
    throw error;
  }
  return {
    chatId: chatName,
    kind: "adopted",
    stagingDir,
  };
}

/**
 * Gives a staged chat its name once its database and settings are in place:
 * the task's own set aside under `.pre-chats/task-records/<chat>`, and the
 * chat's written in that staging put where they were. Each step is skipped
 * once done, so a boot cut short part way picks up where it stopped.
 */
function finishStagedChat(stagingDir: string, rootDir: string) {
  const chatName = path.basename(stagingDir).slice(1, -".partial".length);
  const privateDir = path.join(stagingDir, TASK_PRIVATE_FOLDER_NAME);
  const backup = path.join(
    rootDir,
    BACKUP_DIR_NAME,
    TASK_RECORDS_DIR_NAME,
    chatName,
  );
  const chatDb = path.join(privateDir, CHAT_DB_FILE_NAME);
  if (present(chatDb)) {
    for (const suffix of DB_FILE_SUFFIXES) {
      setAside(
        path.join(privateDir, `${TASK_DB_FILE_NAME}${suffix}`),
        path.join(backup, `${TASK_DB_FILE_NAME}${suffix}`),
      );
    }
    fs.renameSync(chatDb, path.join(privateDir, TASK_DB_FILE_NAME));
  }
  const chatSettings = path.join(privateDir, CHAT_SETTINGS_FILE_NAME);
  if (present(chatSettings)) {
    setAside(
      path.join(privateDir, TASK_SETTINGS_FILE_NAME),
      path.join(backup, TASK_SETTINGS_FILE_NAME),
    );
    fs.renameSync(chatSettings, path.join(privateDir, TASK_SETTINGS_FILE_NAME));
  }
  fs.renameSync(stagingDir, path.join(path.dirname(stagingDir), chatName));
}

/** Finishes the chats an earlier boot staged. Returns whether there were any. */
function finishStagedChats(chatsDir: string, rootDir: string): boolean {
  const staged = readDirs(chatsDir).filter(
    (name) => name.startsWith(".") && name.endsWith(".partial"),
  );
  for (const name of staged) {
    try {
      finishStagedChat(path.join(chatsDir, name), rootDir);
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
 * A task no chat owns: one an earlier version ran on its own. Not a project
 * folder that ended up among the tasks, and not a record a 2.0 build wrote
 * there, which names a chat's session or the chat that started it.
 */
function isLegacyTask(chatDir: string): boolean {
  if (!ChatIdSchema.safeParse(path.basename(chatDir)).success) {
    return false;
  }
  const privateDir = path.join(chatDir, TASK_PRIVATE_FOLDER_NAME);
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

/** Moves a folder into the backup, beside any earlier one of the same name. */
function moveAside(source: string, to: string) {
  let target = to;
  for (let suffix = 2; present(target); suffix += 1) {
    target = `${to}-${suffix}`;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

/** A database and its sidecar files, gone. */
function removeDb(dbPath: string) {
  for (const suffix of DB_FILE_SUFFIXES) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Moves a file into the backup, unless it is already there or was never made. */
function setAside(source: string, to: string) {
  if (!present(source) || present(to)) {
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(source, to);
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
 * words, and nothing else.
 */
function readConversation(dbPath: string): {
  messages: ConversationMessage[];
  title?: string;
  /** Whether it is the tutorial's replay, which a chat is not made for. */
  tutorial: boolean;
} {
  const messages: ConversationMessage[] = [];
  if (!fs.existsSync(dbPath)) {
    return { messages, tutorial: false };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows: StoreRow[];
  try {
    // node:sqlite types a row as a record of any column value; these are two
    // of the store's own columns.
    rows = db
      .prepare(
        `select key, blob from ${STORE_TABLE} where key like 'sessions:%' or key like 'messages:%' or key like 'parts:%'`,
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

/** The hidden name a chat is moved in under until it is finished. */
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
 * The task's folders as the chat holds them, under the names the task knew
 * them by, so a reply naming `/mnt/<folder>/…` reaches the same file from the
 * chat that it did from the task. A folder a project lent the task is the
 * chat's own from here, since the project it came from is gone.
 */
function chatFoldersOf(taskFolders: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(isRecord(taskFolders) ? taskFolders : {}).flatMap(
      ([key, folder]) => {
        if (!isRecord(folder) || typeof folder.path !== "string") {
          return [];
        }
        const mountName =
          typeof folder.mountName === "string" ? folder.mountName : key;
        return [[mountName, { ...folder, mountName, source: "user" }]];
      },
    ),
  );
}

/**
 * The chat's database: its session, then each message and its parts, in one
 * transaction.
 */
function writeChatRows({
  dbPath,
  messages,
  session,
}: {
  dbPath: string;
  messages: ConversationMessage[];
  session: Session.Type;
}) {
  const rows: [string, unknown][] = [[StorageKey.session(session.id), session]];
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
    rows.push([StorageKey.message(session.id, message.id), stored]);
    const metadata = () => ({
      createdAt: message.createdAt,
      id: StoreId.newPartId(),
      messageId: message.id,
      sessionId: session.id,
    });
    const parts: SessionMessagePart.Type[] = message.texts.map((part) => ({
      metadata: { ...metadata(), endedAt: message.createdAt, id: part.id },
      state: "done",
      text: part.text,
      type: "text",
    }));
    if (message.files.length > 0) {
      parts.push({
        data: { files: message.files },
        metadata: metadata(),
        type: "data-attachments",
      });
    }
    for (const part of parts) {
      rows.push([
        StorageKey.part(session.id, message.id, part.metadata.id),
        part,
      ]);
    }
  }

  writeStoreRowsSync(dbPath, rows);
}
