import { glob } from "glob";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, parallel, sort } from "radashi";

import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type Task } from "../schemas/task";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getTaskDirTimestamps } from "./get-task-dir-timestamps";
import { isTaskId } from "./is-task-id";
import { getTaskSettings } from "./task-settings";

export async function getTask(
  id: TaskId,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<Task, TypedError.NotFound | TypedError.Parse>> {
  if (!isTaskId(id)) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  // For tasks the folder name is identical to the id.
  const dir = TaskDirSchema.parse(path.resolve(workspaceConfig.tasksDir, id));

  // Check if the directory exists
  try {
    await fs.access(dir);
  } catch (error) {
    return err(new TypedError.NotFound("App not found", { cause: error }));
  }

  return readTask({ dir });
}

export async function getTasks(
  workspaceConfig: WorkspaceConfig,
  options: {
    direction?: "asc" | "desc";
    limit?: number;
    sortBy?: "createdAt" | "updatedAt";
  } = {},
): Promise<{ tasks: Task[]; total: number }> {
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

  const taskDirs = await taskDirsInRootDir(workspaceConfig.tasksDir);
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

async function readTask({ dir }: { dir: TaskDir }) {
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
  const [settings, timestamps] = await Promise.all([
    getTaskSettings(dir),
    getTaskDirTimestamps(dir),
  ]);

  const task: Task = {
    ...timestamps,
    // A recorded stamp beats an observed one wherever there is one. Tasks from
    // before it was recorded keep the filesystem answer, which is right often
    // enough and settles the first time anything happens in them.
    ...(settings?.lastActivityAt ? { updatedAt: settings.lastActivityAt } : {}),
    id,
    pinnedAt: settings?.pinnedAt,
    projectId: settings?.projectId,
    title: settings?.name ?? rawFolderName,
    unreadIndicator: settings?.unreadIndicator,
  };
  return ok(task);
}
async function taskDirsInRootDir(rootDir: AbsolutePath): Promise<TaskDir[]> {
  // First check if the root dir exists
  const rootDirExists = await fs
    .stat(rootDir)
    .then(() => true)
    .catch(() => false);
  if (!rootDirExists) {
    return [];
  }

  try {
    const entries = await glob("*/", {
      absolute: true,
      cwd: rootDir,
    });
    return entries.map((dir) => TaskDirSchema.parse(dir));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error reading apps folder", error);
    return [];
  }
}
