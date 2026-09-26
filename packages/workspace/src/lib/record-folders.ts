import fs from "node:fs";
import path from "node:path";

import { CHATS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { isChatId } from "../schemas/chat-id";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where a chat's tasks are, by id, for the workspace it was read from. A chat
 * is found by its id alone and a task no chat owns sits flat under `tasks/`,
 * so only a chat's tasks need looking up: the index is read from disk the
 * first time a workspace asks, and kept current by whatever puts a task in a
 * chat or takes one out. Something that moves folders behind its back (the
 * layout migration) calls `forgetRecordFolders` when it is done.
 */
let index: undefined | { root: string; tasks: Map<TaskId, TaskDir> };

/** A chat's own folder. */
export function chatDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(chatsDir(), id));
}

/** Every chat's folder. */
export function chatDirs(): TaskDir[] {
  return listDirs(chatsDir())
    .filter((name) => isChatId(name))
    .map((name) => TaskDirSchema.parse(path.join(chatsDir(), name)));
}

/** The folder every chat is in. */
export function chatsDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, CHATS_DIR_NAME);
}

/** Every task folder inside a chat. */
export function chatTaskDirs(): TaskDir[] {
  return [...nestedTasks().values()];
}

/** The ids of the tasks inside one chat. */
export function chatTaskIds(chatId: TaskId): TaskId[] {
  const inside = chatDir(chatId) + path.sep;
  return [...nestedTasks()].flatMap(([id, dir]) =>
    dir.startsWith(inside) ? [id] : [],
  );
}

/**
 * Whether a chat's task already has this id. Ids are unique across the whole
 * workspace, so a name picked for a task anywhere has to check inside every
 * chat as well as beside the tasks no chat owns.
 */
export function chatTaskIdTaken(id: string): boolean {
  const parsed = TaskIdSchema.safeParse(id);
  return parsed.success && nestedTasks().has(parsed.data);
}

/** The folder a chat's tasks are in. */
export function chatTasksDir(chatId: TaskId): AbsolutePath {
  return absolutePathJoin(chatDir(chatId), TASKS_DIR_NAME);
}

/** Drops a chat and every task in it from the index, once its folder is gone. */
export function forgetChat(chatId: TaskId): void {
  const inside = chatDir(chatId) + path.sep;
  for (const [id, dir] of nestedTasks()) {
    if (dir.startsWith(inside)) {
      index?.tasks.delete(id);
    }
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

/** Records a task made inside a chat, and returns the folder it goes in. */
export function placeChatTask(id: TaskId, chatId: TaskId): TaskDir {
  const dir = TaskDirSchema.parse(path.join(chatTasksDir(chatId), id));
  nestedTasks().set(id, dir);
  return dir;
}

/**
 * The folder a record lives in: a chat's own, a chat's task inside that chat,
 * and any other task flat under `tasks/`.
 */
export function recordDir(id: TaskId): TaskDir {
  if (isChatId(id)) {
    return chatDir(id);
  }
  return (
    nestedTasks().get(id) ??
    TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id))
  );
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

function nestedTasks(): Map<TaskId, TaskDir> {
  const root = getWorkspaceConfig().rootDir;
  if (index?.root === root) {
    return index.tasks;
  }
  const tasks = new Map<TaskId, TaskDir>();
  for (const chat of chatDirs()) {
    const inside = path.join(chat, TASKS_DIR_NAME);
    for (const name of listDirs(inside)) {
      const id = TaskIdSchema.safeParse(name);
      if (id.success) {
        tasks.set(id.data, TaskDirSchema.parse(path.join(inside, name)));
      }
    }
  }
  index = { root, tasks };
  return tasks;
}
