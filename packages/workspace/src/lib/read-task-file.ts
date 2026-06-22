import fs from "node:fs/promises";

import { RelativePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { normalizeTaskFilePath } from "./normalize-task-file-path";
import { resolvePathWithinTaskDir } from "./resolve-path-within-task-dir";
import { taskDir } from "./task-dir-utils";

interface ReadTaskFileOptions {
  filePath: string;
  signal?: AbortSignal;
  taskId: TaskId;
}

export async function readTaskFile({
  filePath,
  signal,
  taskId,
}: ReadTaskFileOptions): Promise<Buffer | null> {
  const cleanPath = normalizeTaskFilePath(filePath);

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
