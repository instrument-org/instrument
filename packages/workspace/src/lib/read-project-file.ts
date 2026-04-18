import ms from "ms";
import fs from "node:fs/promises";

import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { createAppConfig } from "./app-config/create";
import { git } from "./git";
import { GitCommands } from "./git/commands";
import { normalizePath } from "./normalize-path";

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

  if (versionRef) {
    const relativePath = normalizePath(cleanPath);
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

  const fullPath = absolutePathJoin(projectConfig.appDir, cleanPath);
  try {
    return await fs.readFile(fullPath, { signal });
  } catch {
    return null;
  }
}
