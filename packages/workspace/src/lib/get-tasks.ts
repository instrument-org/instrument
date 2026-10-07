import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, parallel, sort } from "radashi";

import { type TaskDir } from "../schemas/paths";
import { type Task } from "../schemas/task";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type TaskSettings } from "../schemas/task-settings";
import { TypedError } from "./errors";
import { getTaskDirTimestamps } from "./get-task-dir-timestamps";
import { isTaskId } from "./is-task-id";
import {
  chatDir,
  chatIds,
  chatTaskDirs,
  dirOf,
  resolveRecord,
} from "./record-folders";
import { getTaskSettings } from "./task-settings";

export interface TaskListOptions {
  direction?: "asc" | "desc";
  limit?: number;
  sortBy?: "createdAt" | "updatedAt";
}

export async function getTask(
  id: TaskId,
): Promise<Result<Task, TypedError.NotFound | TypedError.Parse>> {
  if (!isTaskId(id)) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  const ref = resolveRecord(id);
  if (ref.isErr()) {
    return err(ref.error);
  }
  const dir = dirOf(ref.value);
  try {
    await fs.access(dir);
  } catch (error) {
    return err(new TypedError.NotFound("App not found", { cause: error }));
  }

  return readTask({ dir });
}

export async function getTasks(
  options: TaskListOptions = {},
): Promise<{ tasks: Task[]; total: number }> {
  // Chats and the tasks inside them.
  const taskDirs = [
    ...chatIds().map((chatId) => chatDir(chatId)),
    ...chatTaskDirs(),
  ];
  // Read tasks concurrently; each readTask is several independent fs ops and a
  // workspace can hold many tasks, so a serial loop dominates list latency.
  const taskResults = await parallel({ limit: 12 }, taskDirs, (dir) =>
    readTask({ dir }),
  );
  // Folders whose name isn't a valid task id are skipped silently. They are a
  // recoverable, user-visible condition (surfaced via listInvalidTaskFolders
  // and the Storage settings tab), not a bug -- previously every scan reported
  // one telemetry exception per folder, flooding error reporting.
  const tasks = taskResults
    .filter((result) => result.isOk())
    .map((result) => result.value);

  return sortTasks(tasks, options);
}

/**
 * The tasks in these folders, ordered as asked, leaving out any whose
 * settings are missing or cannot be read. Such a folder is listed in
 * Settings > Storage rather than as a task, and nothing past its settings is
 * read, so listing it never makes anything inside it.
 */
export async function getTasksIn(
  dirs: TaskDir[],
  options: TaskListOptions = {},
): Promise<Task[]> {
  const results = await parallel({ limit: 12 }, dirs, (dir) =>
    readTask({ dir, requireSettings: true }),
  );
  return sortTasks(
    results.filter((result) => result.isOk()).map((result) => result.value),
    options,
  ).tasks;
}

async function readTask({
  dir,
  requireSettings = false,
}: {
  dir: TaskDir;
  /** Refuses a folder whose settings are missing or cannot be read. */
  requireSettings?: boolean;
}) {
  const rawFolderName = path.basename(dir);
  const taskIdResult = TaskIdSchema.safeParse(rawFolderName);

  if (!taskIdResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: taskIdResult.error,
      }),
    );
  }

  const id = taskIdResult.data;
  const ref = resolveRecord(id);
  const settings = await getTaskSettings(dir);
  if (requireSettings && !settings) {
    return err(new TypedError.NotFound("No readable settings"));
  }

  const task: Task = {
    ...(await taskTimestamps(dir, settings)),
    apps: settings?.apps,
    id,
    ...(ref.isOk() && ref.value.kind === "task"
      ? { chatId: ref.value.chatId }
      : {}),
    isChat: ref.isOk() && ref.value.kind === "chat",
    reasoningEffort: settings?.reasoningEffort,
    title: settings?.name ?? rawFolderName,
  };
  return ok(task);
}

/**
 * The order and window the task list asks for, over a set already read.
 *
 * Shared with the live subscription's snapshot, which holds the tasks it has
 * read and applies this per subscriber, so a list patched from one event and a
 * list from a full scan cannot order the same tasks differently.
 */
function sortTasks(
  tasks: Task[],
  options: TaskListOptions = {},
): { tasks: Task[]; total: number } {
  const { direction, limit, sortBy } = assign(
    {
      direction: "desc",
      sortBy: "updatedAt",
    },
    options,
  );
  const sortByFn =
    sortBy === "createdAt"
      ? (task: Task) => task.createdAt.getTime()
      : (task: Task) => task.updatedAt.getTime();

  const sortedTasks = sort(
    tasks,
    (task) => (direction === "asc" ? 1 : -1) * sortByFn(task),
  );

  const total = sortedTasks.length;

  if (limit !== undefined) {
    return { tasks: sortedTasks.slice(0, limit), total };
  }

  return { tasks: sortedTasks, total };
}

/**
 * When the task was made and when something last happened in it.
 *
 * Both are written to settings when the task is created and backfilled for
 * older tasks at boot, so the usual answer is the file already read above and
 * the folder is never touched. It is consulted only for a task missing one of
 * them: one restored by hand, or one whose settings cannot be read.
 */
async function taskTimestamps(
  dir: TaskDir,
  settings: TaskSettings | undefined,
): Promise<{ createdAt: Date; updatedAt: Date }> {
  if (settings?.createdAt && settings.lastActivityAt) {
    return {
      createdAt: settings.createdAt,
      updatedAt: settings.lastActivityAt,
    };
  }

  const observed = await getTaskDirTimestamps(dir);
  return {
    createdAt: settings?.createdAt ?? observed.createdAt,
    updatedAt: settings?.lastActivityAt ?? observed.updatedAt,
  };
}
