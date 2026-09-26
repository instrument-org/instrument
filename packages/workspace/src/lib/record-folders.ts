import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { CHATS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where the chats and the tasks inside them are, for the workspace it was
 * read from. A chat's folder has a readable name of its own, so which session
 * it holds is read from its settings; a task no chat owns sits flat under
 * `tasks/` and needs no looking up. The index is read from disk the first time
 * a workspace asks, and kept current by whatever makes or trashes a chat or a
 * task inside one. Something that moves folders behind its back (the layout
 * migration) calls `forgetRecordFolders` when it is done.
 */
let index:
  | undefined
  | {
      /** Each chat's one session, by the chat's id. */
      chats: Map<TaskId, StoreId.Session>;
      root: string;
      /** Each chat's id, by its session. */
      sessions: Map<StoreId.Session, TaskId>;
      /** Where each task inside a chat is. */
      tasks: Map<TaskId, TaskDir>;
    };

/** A chat's own folder. */
export function chatDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(chatsDir(), id));
}

/** Every chat's folder. */
export function chatDirs(): TaskDir[] {
  return [...read().chats.keys()].map((id) => chatDir(id));
}

/** The chat a session is, or none for a session that is not a chat's. */
export function chatOfSession(sessionId: StoreId.Session): TaskId | undefined {
  return read().sessions.get(sessionId);
}

/** The folder every chat is in. */
export function chatsDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, CHATS_DIR_NAME);
}

/** Every task folder inside a chat. */
export function chatTaskDirs(): TaskDir[] {
  return [...read().tasks.values()];
}

/** The ids of the tasks inside one chat. */
export function chatTaskIds(chatId: TaskId): TaskId[] {
  const inside = chatDir(chatId) + path.sep;
  return [...read().tasks].flatMap(([id, dir]) =>
    dir.startsWith(inside) ? [id] : [],
  );
}

/** The folder a chat's tasks are in. */
export function chatTasksDir(chatId: TaskId): AbsolutePath {
  return absolutePathJoin(chatDir(chatId), TASKS_DIR_NAME);
}

/** Drops a chat and every task in it from the index, once its folder is gone. */
export function forgetChat(chatId: TaskId): void {
  const known = read();
  const inside = chatDir(chatId) + path.sep;
  for (const [id, dir] of known.tasks) {
    if (dir.startsWith(inside)) {
      known.tasks.delete(id);
    }
  }
  const sessionId = known.chats.get(chatId);
  known.chats.delete(chatId);
  if (sessionId) {
    known.sessions.delete(sessionId);
  }
}

/** Drops a chat's task from the index, once its folder is gone. */
export function forgetChatTask(id: TaskId): void {
  index?.tasks.delete(id);
}

/** Reads the index from disk again on its next use. */
export function forgetRecordFolders(): void {
  index = undefined;
}

/** Whether an id is a chat's record rather than a task's. */
export function isChatId(id: string): boolean {
  const parsed = TaskIdSchema.safeParse(id);
  return parsed.success && read().chats.has(parsed.data);
}

/** Records a chat as it is made, and returns the folder it goes in. */
export function placeChat(id: TaskId, sessionId: StoreId.Session): TaskDir {
  const known = read();
  if (known.chats.has(id) || known.tasks.has(id)) {
    throw new Error(`A record already has the id ${id}.`);
  }
  known.chats.set(id, sessionId);
  known.sessions.set(sessionId, id);
  return chatDir(id);
}

/**
 * Records a task made inside a chat, and returns the folder it goes in. The
 * id is reserved at once: two chats picking the same dated name at the same
 * moment would each make a folder in their own `tasks/`, where no single
 * folder stands guard, so the second is refused here instead.
 */
export function placeChatTask(id: TaskId, chatId: TaskId): TaskDir {
  const known = read();
  if (known.tasks.has(id) || known.chats.has(id)) {
    throw new Error(`A record already has the id ${id}.`);
  }
  const dir = TaskDirSchema.parse(path.join(chatTasksDir(chatId), id));
  known.tasks.set(id, dir);
  return dir;
}

/**
 * The folder a record lives in: a chat's own, a chat's task inside that chat,
 * and any other task flat under `tasks/`.
 */
export function recordDir(id: TaskId): TaskDir {
  const known = read();
  if (known.chats.has(id)) {
    return chatDir(id);
  }
  return (
    known.tasks.get(id) ??
    TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id))
  );
}

/**
 * Whether any record already has this id: ids are unique across the whole
 * workspace, so a name picked for a task or a chat anywhere has to check
 * every chat, every task inside one, and the tasks no chat owns.
 */
export function recordIdTaken(id: string): boolean {
  const parsed = TaskIdSchema.safeParse(id);
  if (!parsed.success) {
    return false;
  }
  const known = read();
  return (
    known.chats.has(parsed.data) ||
    known.tasks.has(parsed.data) ||
    fs.existsSync(path.join(chatsDir(), parsed.data)) ||
    fs.existsSync(path.join(getWorkspaceConfig().tasksDir, parsed.data))
  );
}

/** The session a chat's record holds, or none for an id that is not a chat's. */
export function sessionOfChat(id: string): StoreId.Session | undefined {
  const parsed = TaskIdSchema.safeParse(id);
  return parsed.success ? read().chats.get(parsed.data) : undefined;
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

function read() {
  const root = getWorkspaceConfig().rootDir;
  if (index?.root === root) {
    return index;
  }
  const chats = new Map<TaskId, StoreId.Session>();
  const sessions = new Map<StoreId.Session, TaskId>();
  const tasks = new Map<TaskId, TaskDir>();
  const dir = absolutePathJoin(root, CHATS_DIR_NAME);
  for (const name of listDirs(dir)) {
    const id = TaskIdSchema.safeParse(name);
    const sessionId = id.success
      ? storedChatSession(path.join(dir, name))
      : undefined;
    if (!id.success || !sessionId) {
      continue;
    }
    chats.set(id.data, sessionId);
    sessions.set(sessionId, id.data);
    const inside = path.join(dir, name, TASKS_DIR_NAME);
    for (const taskName of listDirs(inside)) {
      const taskId = TaskIdSchema.safeParse(taskName);
      if (taskId.success) {
        tasks.set(
          taskId.data,
          TaskDirSchema.parse(path.join(inside, taskName)),
        );
      }
    }
  }
  index = { chats, root, sessions, tasks };
  return index;
}

/** The session a chat's settings name, read straight from its file. */
function storedChatSession(chatFolder: string): StoreId.Session | undefined {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(
        path.join(
          chatFolder,
          TASK_PRIVATE_FOLDER_NAME,
          TASK_SETTINGS_FILE_NAME,
        ),
        "utf8",
      ),
    );
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const session = StoreId.SessionSchema.safeParse(
      "chatSessionId" in parsed ? parsed.chatSessionId : undefined,
    );
    return session.success ? session.data : undefined;
  } catch {
    return undefined;
  }
}
