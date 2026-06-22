import { EVAL_SUBDOMAIN_PREFIX } from "@instrument-org/shared";
import { glob } from "glob";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, sort } from "radashi";

import { type Task } from "../schemas/app";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getTaskDirTimestamps } from "./get-app-dir-timestamps";
import { isTaskId } from "./is-app";
import { getProjectManifest } from "./project-manifest";
import { assetBaseUrl } from "./url-for-subdomain";

export async function getApp(
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

  return workspaceApp({ dir });
}

export async function getProjects(
  workspaceConfig: WorkspaceConfig,
  options: {
    direction?: "asc" | "desc";
    limit?: number;
    sortBy?: "createdAt" | "updatedAt";
  } = {},
): Promise<{ projects: Task[]; total: number }> {
  const { direction, limit, sortBy } = assign(
    {
      direction: "desc",
      sortBy: "updatedAt",
    },
    options,
  );
  const projects: Task[] = [];
  const sortByFn =
    sortBy === "createdAt"
      ? (project: Task) => project.createdAt.getTime()
      : (project: Task) => project.updatedAt.getTime();

  const projectAppDirs = await appDirsInRootDir(workspaceConfig.tasksDir);
  for (const dir of projectAppDirs) {
    const projectApp = await workspaceApp({ dir });
    if (projectApp.isOk()) {
      projects.push(projectApp.value);
    } else {
      workspaceConfig.captureException(projectApp.error, {
        scopes: ["workspace"],
      });
    }
  }

  const sortedProjects = sort(
    projects,
    (project) => (direction === "asc" ? 1 : -1) * sortByFn(project),
  );

  const total = sortedProjects.length;

  if (limit !== undefined) {
    return { projects: sortedProjects.slice(0, limit), total };
  }

  return { projects: sortedProjects, total };
}

async function appDirsInRootDir(rootDir: AbsolutePath): Promise<TaskDir[]> {
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
async function workspaceApp({ dir }: { dir: TaskDir }) {
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
  const manifest = await getProjectManifest(dir);

  const iconName =
    manifest?.iconName ||
    (id.startsWith(EVAL_SUBDOMAIN_PREFIX) ? "flask-conical" : undefined);

  const task: Task = {
    ...(await getTaskDirTimestamps(dir)),
    assetBase: assetBaseUrl(id),
    description: manifest?.description,
    iconName,
    id,
    title: manifest?.name ?? rawFolderName,
  };
  return ok(task);
}
