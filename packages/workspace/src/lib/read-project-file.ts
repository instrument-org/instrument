import fs from "node:fs/promises";

import {
  RelativePathSchema,
} from "../schemas/paths";
import {
  type TaskId,
} from "../schemas/task-id";
import {
  createAppConfig,
} from "./app-config/create";
import {
  taskDir,
} from "./app-dir-utils";
import {
  normalizeProjectFilePath,
} from "./normalize-project-file-path";
import {
  resolvePathWithinAppDir,
} from "./resolve-path-within-app-dir";

interface ReadProjectFileOptions {
  filePath: string;
  projectSubdomain: TaskId;
  signal?: AbortSignal;
}

export async function readProjectFile({
  filePath,
  projectSubdomain,
  signal,
}: ReadProjectFileOptions): Promise<Buffer | null> {
  const projectConfig = createAppConfig({ subdomain: projectSubdomain });

  const cleanPath = normalizeProjectFilePath(filePath);

  // Fail closed: reject absolute paths and any traversal outside appDir.
  const parsedPath = RelativePathSchema.safeParse(cleanPath);
  if (!parsedPath.success) {
    return null;
  }
  const fullPath = resolvePathWithinAppDir({
    appDir: taskDir(projectConfig),
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
