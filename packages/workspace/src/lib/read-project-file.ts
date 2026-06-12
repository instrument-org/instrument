import ms from "ms";
import fs from "node:fs/promises";
import path from "node:path";

import { RelativePathSchema } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { git } from "./git";
import { GitCommands } from "./git/commands";
import { normalizePath } from "./normalize-path";
import { resolvePathWithinAppDir } from "./resolve-path-within-app-dir";

interface ReadProjectFileOptions {
  filePath: string;
  projectSubdomain: ProjectSubdomain;
  signal?: AbortSignal;
  versionRef?: string;
  workspaceConfig: WorkspaceConfig;
}

export async function readProjectFile({
  filePath,
  projectSubdomain,
  signal,
  versionRef,
  workspaceConfig,
}: ReadProjectFileOptions): Promise<Buffer | null> {
  const projectConfig = createAppConfig({
    subdomain: projectSubdomain,
    workspaceConfig,
  });

  const cleanPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;

  // Fail closed: reject absolute paths and any traversal outside appDir.
  const parsedPath = RelativePathSchema.safeParse(cleanPath);
  if (!parsedPath.success) {
    return null;
  }
  const fullPath = resolvePathWithinAppDir({
    appDir: projectConfig.appDir,
    filePath: parsedPath.data,
  });
  if (!fullPath) {
    return null;
  }

  if (versionRef) {
    const relativePath = normalizePath(
      path.relative(projectConfig.appDir, fullPath),
    );
    const gitResult = await git(
      GitCommands.showFile(versionRef, relativePath),
      projectConfig.appDir,
      { signal: signal ?? AbortSignal.timeout(ms("10 seconds")) },
    );

    if (gitResult.isErr()) {
      return null;
    }

    return gitResult.value.stdout;
  }

  try {
    return await fs.readFile(fullPath, { signal });
  } catch {
    return null;
  }
}
