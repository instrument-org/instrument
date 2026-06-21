import { EVAL_SUBDOMAIN_PREFIX } from "@instrument-org/shared";
import { glob } from "glob";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, sort } from "radashi";

import { type WorkspaceAppProject } from "../schemas/app";
import { type AbsolutePath, type AppDir, AppDirSchema } from "../schemas/paths";
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import {
  type AppSubdomain,
  ProjectSubdomainSchema,
} from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import { isProjectSubdomain } from "./is-app";
import { getProjectManifest } from "./project-manifest";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getApp(
  subdomain: AppSubdomain,
  workspaceConfig: WorkspaceConfig,
): Promise<
  Result<WorkspaceAppProject, TypedError.NotFound | TypedError.Parse>
> {
  if (!isProjectSubdomain(subdomain)) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  // For tasks the folder name is identical to the subdomain.
  const appDir = AppDirSchema.parse(
    path.resolve(workspaceConfig.projectsDir, subdomain),
  );

  // Check if the directory exists
  try {
    await fs.access(appDir);
  } catch (error) {
    return err(new TypedError.NotFound("App not found", { cause: error }));
  }

  return workspaceApp({ appDir });
}

export async function getProjects(
  workspaceConfig: WorkspaceConfig,
  options: {
    direction?: "asc" | "desc";
    limit?: number;
    sortBy?: "createdAt" | "updatedAt";
  } = {},
): Promise<{ projects: WorkspaceAppProject[]; total: number }> {
  const { direction, limit, sortBy } = assign(
    {
      direction: "desc",
      sortBy: "updatedAt",
    },
    options,
  );
  const projects: WorkspaceAppProject[] = [];
  const sortByFn =
    sortBy === "createdAt"
      ? (project: WorkspaceAppProject) => project.createdAt.getTime()
      : (project: WorkspaceAppProject) => project.updatedAt.getTime();

  const projectAppDirs = await appDirsInRootDir(workspaceConfig.projectsDir);
  for (const appDir of projectAppDirs) {
    const projectApp = await workspaceApp({ appDir });
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

async function appDirsInRootDir(rootDir: AbsolutePath): Promise<AppDir[]> {
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
    return entries.map((appDir) => AppDirSchema.parse(appDir));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error reading apps folder", error);
    return [];
  }
}
async function getAppTitle(
  appDir: AppDir,
  folderName: string,
): Promise<string> {
  try {
    const questManifest = await getProjectManifest(appDir);
    return questManifest?.name ?? folderName;
  } catch {
    return folderName;
  }
}

async function workspaceApp({ appDir }: { appDir: AppDir }) {
  const rawFolderName = path.basename(appDir);
  const folderNameResult = SubdomainPartSchema.safeParse(rawFolderName);

  if (!folderNameResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: folderNameResult.error,
      }),
    );
  }

  const subdomainResult = ProjectSubdomainSchema.safeParse(
    folderNameResult.data,
  );

  if (!subdomainResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: subdomainResult.error,
      }),
    );
  }

  const title = await getAppTitle(appDir, rawFolderName);
  const manifest = await getProjectManifest(appDir);

  const iconName =
    manifest?.iconName ||
    (subdomainResult.data.startsWith(EVAL_SUBDOMAIN_PREFIX)
      ? "flask-conical"
      : undefined);

  const projectApp: WorkspaceAppProject = {
    ...(await getAppDirTimestamps(appDir)),
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
