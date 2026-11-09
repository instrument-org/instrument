import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

import {
  CHAT_DB_FILE_NAME,
  LEGACY_TASK_DB_FILE_NAME,
  CHAT_FOLDER_NAMES,
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
import { chatFolderName } from "./chat-folder-name";
import { toTheSecond } from "./chat/project-file";
import {
  type Project,
  type ProjectFolder,
  projectName,
  readProjectsSync,
  unusedProjectName,
  writeProjectSync,
} from "./chat/projects";
import { addProjectFoldersSync } from "./permissions/project-folders";
import { readStoreCopy } from "./read-store-copy";
import { forgetChatFolders } from "./record-folders";
import { isRecord } from "./skills";
import { STORE_TABLE, writeStoreRowsSync } from "./store-table";
import { StorageKey } from "./storage-key";
import { legacyProjectsDir, workspaceLayout } from "./workspace-layout";

// What the move leaves behind is kept in the workspace's set-aside folder, so a
// migration that went wrong can be undone by hand: the 1.x projects, once
// the projects they become are written, the tasks with nothing the user said in them, each
// chat's 1.x settings and database as the task had them, and anything found
// holding the name a chat is staged under.
const LEGACY_PROJECTS_DIR_NAME = "projects";
const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
const EMPTY_TASKS_DIR_NAME = "empty-tasks";
const TASK_RECORDS_DIR_NAME = "task-records";
const STAGED_CHATS_DIR_NAME = "staged-chats";

// What a task carries while it is staged as a chat: the chat's database and
// settings, written beside the task's own and put in their place once the
// folder is among the chats.
const STAGED_CHAT_DB_FILE_NAME = ".chat.db";
const STAGED_CHAT_SETTINGS_FILE_NAME = ".chat-settings.json";

// SQLite keeps sidecar files next to a database; they travel with it.
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

// The model the tutorial's replay ran on, which marks a task as the tutorial.
const TUTORIAL_MODEL = "tutorial-task-replay";

// A leading emoji in a 1.x project's folder name, with the space after it:
// the mark 1.x users gave their projects, which a project keeps as its mark.
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
  /** Projects written for 1.x projects that matched none. */
  projectCount: number;
  /**
   * Tasks left where they are, named, because the database holding their
   * conversation could not be read: a person can look at one, and no later
   * boot reads it any better, so they are not counted as left over.
   */
  unreadable: string[];
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
  /** The folders its tasks worked in, which the project's chats are given. */
  folders: ProjectFolder[];
  id: string;
  instructions: string;
  name: string;
  /** Its folder, waiting in the staged `projects/` or already set aside. */
  source: string;
}

interface StoreRow {
  blob: null | Uint8Array;
  key: string;
}

/**
 * Makes every task an earlier version ran on its own into a chat, and every
 * 1.x project into a project. The task's folder becomes the chat's, files and all,
 * so a path its replies named is the same path in the chat; its database is
 * rewritten as the chat's one conversation, holding what the user saw (their
 * words and files, and the replies) under the ids they had. A 1.x project
 * becomes a project of the same name and id, or joins the project already
 * called that, and its instructions become the project's; the chats of its
 * tasks are filed under that project.
 *
 * Runs with the layout sweep in `migrateWorkspaceLayout`, once per layout
 * version, and decides from the data: a task under `tasks/` that no chat
 * started is one to adopt, and 1.x's `projects/` holding a project is one
 * to turn into a project.
 * Synchronous and file-level, with no store open and no workspace config.
 * A 1.x project's folders are granted under its project in this computer's
 * permission settings, in `machineDir`, since each names a path here.
 *
 * The chat's database and settings are written beside the task's own, the
 * folder moved among the chats under a hidden name, the task's files set
 * aside for the chat's, and only then the folder given its real name, so no
 * chat is listed half made, and a boot cut short part way finishes the chat
 * it left.
 */
export function migrateLegacyTasks(
  rootDir: string,
  machineDir: string,
): LegacyTasksMigration {
  const migration: LegacyTasksMigration = {
    adoptedCount: 0,
    emptyCount: 0,
    leftOver: 0,
    projectCount: 0,
    unreadable: [],
  };
  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  const { chatsDir } = workspaceLayout(rootDir);
  const staged = finishStagedChats(chatsDir, rootDir);
  migration.leftOver += staged.left;
  const legacy = readDirs(tasksDir).filter((name) =>
    isLegacyTask(path.join(tasksDir, name)),
  );
  const waitingDir = legacyProjectsDir(rootDir);
  const waitingProjects = readDirs(waitingDir).filter((name) =>
    isLegacyProjectFolder(path.join(waitingDir, name)),
  );
  if (
    legacy.length === 0 &&
    waitingProjects.length === 0 &&
    staged.staged === 0
  ) {
    return migration;
  }

  const legacyProjects = readLegacyProjects(rootDir);
  const projectOf = new Map<string, string>();
  const projects = readProjectsSync(rootDir);
  const legacyIds = new Set(legacyProjects.map((each) => each.id));
  for (const legacyProject of legacyProjects) {
    try {
      const project = projectForLegacy({
        legacy: legacyProject,
        legacyIds,
        projects,
        rootDir,
      });
      addProjectFoldersSync({
        machineDir,
        paths: legacyProject.folders.map((folder) => folder.path),
        projectId: project.id,
      });
      if (project.made) {
        migration.projectCount += 1;
      }
      projectOf.set(legacyProject.id, project.id);
    } catch {
      migration.leftOver += 1;
    }
  }

  // Every name in use, so a chat's name is unique across the chats, the
  // chats an earlier boot staged and could not name yet, the tasks inside
  // them, and the tasks no chat owns.
  const taken = new Set([
    ...readDirs(chatsDir),
    ...readDirs(chatsDir).flatMap((name) => stagedChatName(name) ?? []),
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
        projectOf,
      });
      if (adopted.kind === "empty") {
        migration.emptyCount += 1;
      } else if (adopted.kind === "unreadable") {
        migration.unreadable.push(path.join(tasksDir, name));
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

  // A 1.x project is set aside once its project is written; one whose
  // project could not be is left for the next boot.
  for (const name of waitingProjects) {
    const legacyProject = legacyProjects.find(
      (candidate) => candidate.source === path.join(waitingDir, name),
    );
    if (!legacyProject || !projectOf.has(legacyProject.id)) {
      continue;
    }
    try {
      moveAside(
        legacyProject.source,
        path.join(
          workspaceLayout(rootDir).setAsideDir,
          LEGACY_PROJECTS_DIR_NAME,
          name,
        ),
      );
    } catch {
      migration.leftOver += 1;
    }
  }
  // Only an empty folder goes: what else is in it, a file beside the
  // projects, the layout sweep sets aside after this.
  if (fs.existsSync(waitingDir) && fs.readdirSync(waitingDir).length === 0) {
    fs.rmdirSync(waitingDir);
  }

  forgetChatFolders();
  return migration;
}

/**
 * One task made into a staged chat, which the caller names once every task
 * has been staged; or set aside, for the tutorial and a task the user
 * never said anything in; or left where it is, for one whose database could
 * not be read. Throws when anything fails, leaving the task where it was and
 * no chat staged.
 */
function adoptTask({
  chatsDir,
  rootDir,
  taken,
  chatDir,
  projectOf,
}: {
  chatsDir: string;
  rootDir: string;
  taken: Set<string>;
  chatDir: string;
  projectOf: Map<string, string>;
}):
  | {
      /** The chat's id, the folder it lands in once staged. */
      chatId: string;
      kind: "adopted";
      stagingDir: string;
    }
  | { kind: "empty" }
  | { kind: "unreadable" } {
  const taskName = path.basename(chatDir);
  const privateDir = path.join(chatDir, PRIVATE_FOLDER_NAME);
  const settings = readJson(path.join(privateDir, SETTINGS_FILE_NAME)) ?? {};
  const conversation = readConversation(
    path.join(privateDir, LEGACY_TASK_DB_FILE_NAME),
  );
  // A database nobody can read may hold the whole conversation, so the task
  // stays where it is rather than being set aside as one holding nothing.
  if (conversation.unreadable) {
    return { kind: "unreadable" };
  }
  if (
    conversation.tutorial ||
    !conversation.messages.some((message) => message.role === "user")
  ) {
    moveAside(
      chatDir,
      path.join(
        workspaceLayout(rootDir).setAsideDir,
        EMPTY_TASKS_DIR_NAME,
        taskName,
      ),
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
  const projectId =
    typeof settings.projectId === "string"
      ? projectOf.get(settings.projectId)
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
    ...(projectId ? { project: projectId } : {}),
    updatedAt: lastActivityAt,
  };

  const chatDb = path.join(privateDir, STAGED_CHAT_DB_FILE_NAME);
  const chatSettings = path.join(privateDir, STAGED_CHAT_SETTINGS_FILE_NAME);
  const stagingDir = path.join(chatsDir, stagingName(chatName));
  // Whatever holds the name is kept, as a chat's files may be in it.
  if (present(stagingDir)) {
    moveAside(
      stagingDir,
      path.join(
        workspaceLayout(rootDir).setAsideDir,
        STAGED_CHATS_DIR_NAME,
        chatName,
      ),
    );
  }
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
        grants: chatGrantsOf(
          isRecord(settings.state) ? settings.state.attachedFolders : undefined,
          createdAt,
        ),
        lastActivityAt: lastActivityAt.toISOString(),
        ...(isRecord(settings.state) &&
        typeof settings.state.selectedModelURI === "string"
          ? { modelURI: settings.state.selectedModelURI }
          : {}),
        state: {},
      }),
    );
    fs.mkdirSync(path.join(chatDir, CHAT_FOLDER_NAMES.attachments), {
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
 * the task's own set aside under `.pre-chats/task-records/<chat>` in the
 * workspace's `.instrument/`, and the
 * chat's written in that staging put where they were. Each step is skipped
 * once done, so a boot cut short part way picks up where it stopped.
 *
 * Nothing in the staging is written over: anything already under the name
 * the chat's own database or settings take is set aside with the task's own
 * first, since a rename over it would leave no copy of whatever it held.
 */
function finishStagedChat(stagingDir: string, rootDir: string) {
  const chatName =
    stagedChatName(path.basename(stagingDir)) ?? path.basename(stagingDir);
  const privateDir = path.join(stagingDir, PRIVATE_FOLDER_NAME);
  const backup = path.join(
    workspaceLayout(rootDir).setAsideDir,
    TASK_RECORDS_DIR_NAME,
    chatName,
  );
  const chatDb = path.join(privateDir, STAGED_CHAT_DB_FILE_NAME);
  if (present(chatDb)) {
    for (const suffix of DB_FILE_SUFFIXES) {
      for (const name of [LEGACY_TASK_DB_FILE_NAME, CHAT_DB_FILE_NAME]) {
        setAside(
          path.join(privateDir, `${name}${suffix}`),
          path.join(backup, `${name}${suffix}`),
        );
      }
    }
    fs.renameSync(chatDb, path.join(privateDir, CHAT_DB_FILE_NAME));
  }
  const chatSettings = path.join(privateDir, STAGED_CHAT_SETTINGS_FILE_NAME);
  if (present(chatSettings)) {
    setAside(
      path.join(privateDir, SETTINGS_FILE_NAME),
      path.join(backup, SETTINGS_FILE_NAME),
    );
    fs.renameSync(chatSettings, path.join(privateDir, SETTINGS_FILE_NAME));
  }
  fs.renameSync(stagingDir, path.join(path.dirname(stagingDir), chatName));
}

/**
 * Finishes the chats an earlier boot staged. Says how many there were, and
 * how many are still staged for the next boot to finish.
 */
function finishStagedChats(
  chatsDir: string,
  rootDir: string,
): { left: number; staged: number } {
  const staged = readDirs(chatsDir).filter(
    (name) => stagedChatName(name) !== undefined,
  );
  let left = 0;
  for (const name of staged) {
    try {
      finishStagedChat(path.join(chatsDir, name), rootDir);
    } catch {
      left += 1;
    }
  }
  return { left, staged: staged.length };
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
  const privateDir = path.join(chatDir, PRIVATE_FOLDER_NAME);
  const settingsPath = path.join(privateDir, SETTINGS_FILE_NAME);
  // The earliest builds could leave a task with a database and no settings
  // yet, which is a task like any other. Settings that cannot be read are
  // left alone.
  const settings = present(settingsPath)
    ? readJson(settingsPath)
    : present(path.join(privateDir, LEGACY_TASK_DB_FILE_NAME))
      ? {}
      : undefined;
  return (
    settings !== undefined &&
    settings.parentTaskId === undefined &&
    settings.chatSessionId === undefined &&
    !ProjectIdSchema.safeParse(settings.id).success
  );
}

function isLegacyProjectFolder(folder: string): boolean {
  const settings = readJson(
    path.join(folder, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
  );
  return ProjectIdSchema.safeParse(settings?.id).success;
}

/**
 * Moves a file or folder into the backup, beside any earlier one of the same
 * name.
 */
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

/**
 * Moves a file into the backup, unless it was never made. One already there
 * under that name is from an earlier chat staged under this one's name, and
 * keeps its place: this one goes beside it rather than staying in the folder
 * the chat's own file is about to take, where nothing would read it and the
 * chat would open beside a 1.x record of someone else's conversation.
 */
function setAside(source: string, to: string) {
  if (!present(source)) {
    return;
  }
  moveAside(source, to);
}

/** A name without its leading emoji, as a project's name is compared. */
function nameKey(name: string): string {
  return projectName(name.replace(LEADING_EMOJI, "")).toLowerCase();
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
 * A 1.x project's folders as a project holds them: by path, a 1.x project
 * having stored either the bare path or the path with its access, which a
 * project's folders no longer carry.
 */
function legacyProjectFolders(raw: unknown): ProjectFolder[] {
  return (Array.isArray(raw) ? raw : []).flatMap((folder): ProjectFolder[] => {
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
 *
 * A database SQLite cannot read, or one with no store table in it, is
 * answered as itself rather than as a task nobody said anything in: what it
 * holds is unknown, so the task it belongs to is left where it is instead of
 * being set aside for holding nothing.
 */
function readConversation(dbPath: string): {
  messages: ConversationMessage[];
  title?: string;
  /** Whether it is the tutorial's replay, which a chat is not made for. */
  tutorial: boolean;
  /** Whether the database is there and could not be read. */
  unreadable: boolean;
} {
  const messages: ConversationMessage[] = [];
  if (!fs.existsSync(dbPath)) {
    return { messages, tutorial: false, unreadable: false };
  }
  let rows: StoreRow[];
  try {
    rows = readStoreCopy(
      dbPath,
      (db) =>
        // node:sqlite types a row as a record of any column value; these are
        // two of the store's own columns.
        db
          .prepare(
            `select key, blob from ${STORE_TABLE} where key like 'sessions:%' or key like 'messages:%' or key like 'parts:%'`,
          )
          .all() as unknown as StoreRow[],
    );
  } catch {
    return { messages, tutorial: false, unreadable: true };
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
    unreadable: false,
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
 * Every 1.x project, waiting in the staged `projects/` or already set aside
 * by an earlier boot, so a task a later boot adopts still finds its project.
 */
function readLegacyProjects(rootDir: string): LegacyProject[] {
  const dirs = [
    legacyProjectsDir(rootDir),
    path.join(workspaceLayout(rootDir).setAsideDir, LEGACY_PROJECTS_DIR_NAME),
  ];
  return dirs.flatMap((dir) =>
    readDirs(dir).flatMap((name): LegacyProject[] => {
      const source = path.join(dir, name);
      const settings = readJson(
        path.join(source, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
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
      const bare = projectName(name.replace(LEADING_EMOJI, "")) || name;
      return [
        {
          createdAt:
            validDate(settings?.createdAt)?.getTime() ??
            fs.statSync(source).birthtimeMs,
          ...(emoji ? { emoji } : {}),
          folders: legacyProjectFolders(settings?.folders),
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

/** The chat a staging folder's name stands for, or undefined for any other name. */
function stagedChatName(name: string): string | undefined {
  return name.startsWith(".") && name.endsWith(".partial")
    ? name.slice(1, -".partial".length)
    : undefined;
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
 * The project a 1.x project's chats are filed under: its own, from an earlier
 * boot, or the one already called by its name, with the 1.x project's
 * instructions added after its own, or a new one made from it under the 1.x
 * project's id. Asking again for the same 1.x project changes nothing, since
 * what it would add is already there.
 */
function projectForLegacy({
  legacy,
  legacyIds,
  projects,
  rootDir,
}: {
  legacy: LegacyProject;
  /** Every 1.x project's id, each of which names a project made from it. */
  legacyIds: Set<string>;
  projects: Project[];
  rootDir: string;
}): { id: string; made: boolean } {
  // Its own project first, from an earlier boot: one made under its id, or
  // one a build that called projects topics made from it or joined to it,
  // naming it in `projectId`. Otherwise one of the user's of the same name,
  // never another 1.x project's: names are cut to a project's length, so two
  // long names can meet.
  const own = projects.findIndex(
    (project) => project.id === legacy.id || legacyIdOf(project) === legacy.id,
  );
  const index =
    own === -1
      ? projects.findIndex(
          (project) =>
            !legacyIds.has(project.id) &&
            legacyIdOf(project) === undefined &&
            !project.retired &&
            nameKey(project.name) === nameKey(legacy.name),
        )
      : own;
  const existing = projects[index];
  if (existing) {
    const body = existing.instructions?.trim() ?? "";
    const addsInstructions =
      legacy.instructions !== "" && !body.includes(legacy.instructions);
    if (addsInstructions || own === -1) {
      const next: Project = {
        ...existing,
        ...(existing.id === legacy.id || legacyIdOf(existing) !== undefined
          ? {}
          : { others: { ...existing.others, projectId: legacy.id } }),
        ...(addsInstructions
          ? {
              instructions: body
                ? `${body}\n\n${legacy.instructions}`
                : legacy.instructions,
            }
          : {}),
      };
      writeProjectSync(rootDir, next);
      projects[index] = next;
    }
    return { id: existing.id, made: false };
  }
  const project: Project = {
    created: toTheSecond(new Date(legacy.createdAt)),
    ...(legacy.emoji ? { emoji: legacy.emoji } : {}),
    id: legacy.id,
    ...(legacy.instructions ? { instructions: legacy.instructions } : {}),
    name: unusedProjectName(
      legacy.name,
      projects.map((known) => known.name),
    ),
  };
  writeProjectSync(rootDir, project);
  projects.push(project);
  return { id: project.id, made: true };
}

/**
 * The 1.x project a project was joined to, which a build that called
 * projects topics kept as `projectId` in its front matter.
 */
function legacyIdOf(project: Project): string | undefined {
  const id = project.others?.projectId;
  return typeof id === "string" ? id : undefined;
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * A 1.x task's attached folders as the chat's grants: each a folder the user
 * sent, granted when it was attached.
 */
function chatGrantsOf(taskFolders: unknown, createdAt: Date): unknown[] {
  return Object.values(isRecord(taskFolders) ? taskFolders : {}).flatMap(
    (folder) => {
      if (!isRecord(folder) || typeof folder.path !== "string") {
        return [];
      }
      const grantedAt =
        typeof folder.createdAt === "number"
          ? new Date(folder.createdAt)
          : createdAt;
      return [
        {
          grantedAt: grantedAt.toISOString(),
          path: folder.path,
          source: "attached",
        },
      ];
    },
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
