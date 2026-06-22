import fs from "node:fs/promises";

import { RelativePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";
import { normalizeProjectFilePath } from "./normalize-project-file-path";
import { resolvePathWithinTaskDir } from "./resolve-path-within-app-dir";

interface ReadProjectFileOptions {
  filePath: string;
  signal?: AbortSignal;
  taskId: TaskId;
}

export async function readProjectFile({
  filePath,
  signal,
  taskId,
}: ReadProjectFileOptions): Promise<Buffer | null> {
  const cleanPath = normalizeProjectFilePath(filePath);

  // Fail closed: reject absolute paths and any traversal outside dir.
  const parsedPath = RelativePathSchema.safeParse(cleanPath);
  if (!parsedPath.success) {
    return null;
  }
  const fullPath = resolvePathWithinTaskDir({
    dir: taskDir(taskId),
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
