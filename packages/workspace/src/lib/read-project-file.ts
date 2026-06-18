import fs from "node:fs/promises";

import { RelativePathSchema } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { resolvePathWithinAppDir } from "./resolve-path-within-app-dir";

interface ReadProjectFileOptions {
  filePath: string;
  projectSubdomain: ProjectSubdomain;
  signal?: AbortSignal;
  workspaceConfig: WorkspaceConfig;
}

export async function readProjectFile({
  filePath,
  projectSubdomain,
  signal,
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

  try {
    return await fs.readFile(fullPath, { signal });
  } catch {
    return null;
  }
}
