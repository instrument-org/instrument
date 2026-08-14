import fs from "node:fs/promises";

import { WorkspaceFilePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { normalizeTaskFilePath } from "./normalize-task-file-path";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";

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

  // Fail closed: accept only a task-relative path or an attached folder's mount
  // path, and let the layout decide where each one lands.
  const parsedPath = WorkspaceFilePathSchema.safeParse(cleanPath);
  if (!parsedPath.success) {
    return null;
  }
  const fullPath = await resolveWorkspaceFilePath({
    filePath: parsedPath.data,
    taskId,
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
