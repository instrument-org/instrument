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
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getTaskDirTimestamps } from "./get-app-dir-timestamps";
import { isProjectSubdomain } from "./is-app";
import { getProjectManifest } from "./project-manifest";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getApp(
  subdomain: TaskId,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<Task, TypedError.NotFound | TypedError.Parse>> {
  if (!isProjectSubdomain(subdomain)) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  // For tasks the folder name is identical to the subdomain.
  const dir = TaskDirSchema.parse(
    path.resolve(workspaceConfig.tasksDir, subdomain),
  );

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
async function getAppTitle(dir: TaskDir, folderName: string): Promise<string> {
  try {
    const questManifest = await getProjectManifest(dir);
    return questManifest?.name ?? folderName;
  } catch {
    return folderName;
  }
}

async function workspaceApp({ dir }: { dir: TaskDir }) {
  const rawFolderName = path.basename(dir);
  const folderNameResult = SubdomainPartSchema.safeParse(rawFolderName);

  if (!folderNameResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: folderNameResult.error,
      }),
    );
  }

  const subdomainResult = TaskIdSchema.safeParse(folderNameResult.data);

  if (!subdomainResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: subdomainResult.error,
      }),
    );
  }

  const title = await getAppTitle(dir, rawFolderName);
  const manifest = await getProjectManifest(dir);

  const iconName =
    manifest?.iconName ||
    (subdomainResult.data.startsWith(EVAL_SUBDOMAIN_PREFIX)
      ? "flask-conical"
      : undefined);

  const projectApp: Task = {
    ...(await getTaskDirTimestamps(dir)),
    description: manifest?.description,
    folderName: rawFolderName,
    iconName,
    subdomain: subdomainResult.data,
    title,
    type: "project",
    urls: urlsForSubdomain(subdomainResult.data),
  };
  return ok(projectApp);
}
