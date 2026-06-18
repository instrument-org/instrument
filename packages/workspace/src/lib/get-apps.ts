import { EVAL_SUBDOMAIN_PREFIX } from "@instrument-org/shared";
import { glob } from "glob";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, sort } from "radashi";

import {
  type WorkspaceApp,
  type WorkspaceAppPreview,
  type WorkspaceAppProject,
  type WorkspaceAppSandbox,
} from "../schemas/app";
import { type AbsolutePath, type AppDir, AppDirSchema } from "../schemas/paths";
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import {
  type AppSubdomain,
  AppSubdomainSchema,
  PREVIEW_SUBDOMAIN_PART,
  type PreviewSubdomain,
  PreviewSubdomainSchema,
  type ProjectSubdomain,
  ProjectSubdomainSchema,
  type SandboxSubdomain,
  SandboxSubdomainSchema,
} from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { getSandboxesDir } from "./app-dir-utils";
import { TypedError } from "./errors";
import { folderNameForSubdomain } from "./folder-name-for-subdomain";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import {
  isPreviewSubdomain,
  isProjectSubdomain,
  isSandboxSubdomain,
} from "./is-app";
import { getProjectManifest } from "./project-manifest";
import { urlsForSubdomain } from "./url-for-subdomain";

// Type mapping for generic subdomain to workspace app type conversion
type GetAppResult<T extends AppSubdomain> = T extends PreviewSubdomain
  ? WorkspaceAppPreview
  : T extends ProjectSubdomain
    ? WorkspaceAppProject
    : T extends SandboxSubdomain
      ? WorkspaceAppSandbox
      : WorkspaceApp;

export async function getApp<T extends AppSubdomain>(
  subdomain: T,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<GetAppResult<T>, TypedError.NotFound | TypedError.Parse>> {
  const rawFolderName = folderNameForSubdomain(subdomain);
  if (rawFolderName.isErr()) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: rawFolderName.error,
      }),
    );
  }

  // Handle sandbox subdomains which have format: sandbox-{name}.{project-subdomain}
  if (isSandboxSubdomain(subdomain)) {
    const [_sandboxPartialSubdomain, rawProjectSubdomain] =
      subdomain.split(".");
    const projectSubdomain = AppSubdomainSchema.parse(rawProjectSubdomain);
    if (!isProjectSubdomain(projectSubdomain)) {
      return err(
        new TypedError.Parse("Invalid folder name", {
          cause: projectSubdomain,
        }),
      );
    }

    // First get the project app
    const projectConfig = createAppConfig({
      subdomain: AppSubdomainSchema.parse(rawProjectSubdomain),
      workspaceConfig,
    });

    if (projectConfig.type !== "project") {
      return err(
        new TypedError.Parse("Invalid folder name", {
          cause: projectConfig.type,
        }),
      );
    }

    const sandboxDir = AppDirSchema.parse(
      path.resolve(getSandboxesDir(projectConfig.appDir), rawFolderName.value),
    );

    // Check if the sandbox directory exists
    try {
      await fs.access(sandboxDir);
    } catch (error) {
      return err(new TypedError.NotFound("App not found", { cause: error }));
    }

    const parent = await getApp(projectConfig.subdomain, workspaceConfig);
    if (parent.isErr()) {
      return err(parent.error);
    }

    // Create the sandbox app
    const sandboxResult = await workspaceApp({
      appDir: sandboxDir,
      parent: parent.value,
    });

    if (sandboxResult.isErr()) {
      return sandboxResult;
    }

    return ok(sandboxResult.value as GetAppResult<T>);
  }

  // Handle preview and project subdomains

  let appDir: AppDir;
  let parent: "previews" | "projects";

  if (isPreviewSubdomain(subdomain)) {
    appDir = AppDirSchema.parse(
      path.resolve(workspaceConfig.previewsDir, rawFolderName.value),
    );
    parent = "previews";
  } else if (isProjectSubdomain(subdomain)) {
    appDir = AppDirSchema.parse(
      path.resolve(workspaceConfig.projectsDir, rawFolderName.value),
    );
    parent = "projects";
  } else {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  // Check if the directory exists
  try {
    await fs.access(appDir);
  } catch (error) {
    return err(new TypedError.NotFound("App not found", { cause: error }));
  }

  // Create the workspace app
  const appResult = await workspaceApp({
    appDir,
    parent,
  });

  if (appResult.isErr()) {
    return appResult;
  }

  return ok(appResult.value as GetAppResult<T>);
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
    const projectApp = await workspaceApp({
      appDir,
      parent: "projects",
    });
    if (projectApp.isOk() && projectApp.value.type === "project") {
      projects.push(projectApp.value);
    } else {
      if (projectApp.isErr()) {
        workspaceConfig.captureException(projectApp.error, {
          scopes: ["workspace"],
        });
      } else {
        workspaceConfig.captureException(
          new TypedError.Parse(
            `Invalid project app type ${projectApp.value.type}`,
          ),
          { scopes: ["workspace"] },
        );
      }
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

export async function getSandboxesForProject(
  projectApp: WorkspaceAppProject,
  workspaceConfig: WorkspaceConfig,
): Promise<WorkspaceAppSandbox[]> {
  const projectConfig = createAppConfig({
    subdomain: projectApp.subdomain,
    workspaceConfig,
  });

  const sandboxesDir = getSandboxesDir(projectConfig.appDir);
  const sandboxDirs = await appDirsInRootDir(sandboxesDir);
  const sandboxes: WorkspaceAppSandbox[] = [];

  for (const sandboxDir of sandboxDirs) {
    const sandboxApp = await workspaceApp({
      appDir: sandboxDir,
      parent: projectApp,
    });
    if (sandboxApp.isOk() && sandboxApp.value.type === "sandbox") {
      sandboxes.push(sandboxApp.value);
    }
  }

  return sandboxes;
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

async function workspaceApp({
  appDir,
  parent,
}: {
  appDir: AppDir;
  parent: "previews" | "projects" | WorkspaceAppProject;
}) {
  const rawFolderName = path.basename(appDir);
  const folderNameResult = SubdomainPartSchema.safeParse(rawFolderName);

  if (!folderNameResult.success) {
    return err(
      new TypedError.Parse("Invalid folder name", {
        cause: folderNameResult.error,
      }),
    );
  }

  if (parent === "projects") {
    const possibleSubdomain = folderNameResult.data;
    const subdomainResult = ProjectSubdomainSchema.safeParse(possibleSubdomain);

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

  if (parent === "previews") {
    const possibleSubdomain = `${folderNameResult.data}.${PREVIEW_SUBDOMAIN_PART}`;
    const rawSubdomain = PreviewSubdomainSchema.safeParse(possibleSubdomain);

    if (!rawSubdomain.success) {
      return err(
        new TypedError.Parse("Invalid folder name", {
          cause: rawSubdomain.error,
        }),
      );
    }

    const title = await getAppTitle(appDir, rawFolderName);

    const previewApp: WorkspaceAppPreview = {
      ...(await getAppDirTimestamps(appDir)),
      folderName: rawFolderName,
      subdomain: rawSubdomain.data,
      title,
      type: "preview",
      urls: urlsForSubdomain(rawSubdomain.data),
    };
    return ok(previewApp);
  }

  const possibleSandboxSubdomain = `sandbox-${folderNameResult.data}.${parent.subdomain}`;
  const sandboxSubdomainResult = SandboxSubdomainSchema.safeParse(
    possibleSandboxSubdomain,
  );

  if (sandboxSubdomainResult.success) {
    const title = await getAppTitle(appDir, rawFolderName);

    const sandboxApp: WorkspaceAppSandbox = {
      ...(await getAppDirTimestamps(appDir)),
      folderName: rawFolderName,
      project: parent,
      subdomain: sandboxSubdomainResult.data,
      title,
      type: "sandbox",
      urls: urlsForSubdomain(sandboxSubdomainResult.data),
    };
    return ok(sandboxApp);
  }

  return err(
    new TypedError.Parse("Invalid folder name", {
      cause: sandboxSubdomainResult.error,
    }),
  );
}
