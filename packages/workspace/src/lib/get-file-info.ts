import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { TypedError } from "./errors";
import { getMimeType } from "./get-mime-type";
import { resolveExistingFilePath } from "./resolve-agent-path";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-state-store";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

export const CurrentFileInfoSchema = z.object({
  filename: z.string(),
  filePath: z.string(),
  mimeType: z.string(),
  modifiedAt: z.number(),
});

export async function getCurrentFileInfo({
  filePath,
  taskId,
}: {
  filePath: WorkspaceFilePath;
  taskId: TaskId;
}) {
  const filename = path.basename(filePath);
  const mimeType = getMimeType(filename);

  if (!filename) {
    return err(new TypedError.NotFound("File path has no filename"));
  }

  const taskHostRoot = taskDir(taskId);
  const taskState = await getTaskState(taskHostRoot);
  const resolved = resolveExistingFilePath({
    inputPath: filePath,
    layout: buildWorkspaceFsLayout({
      attachedFolders: taskState.attachedFolders,
      taskHostRoot,
    }),
  });
  if (resolved.isErr()) {
    return err(new TypedError.NotFound(`File not found: ${filePath}`));
  }

  let modifiedAt: number;
  try {
    const stats = await fs.stat(resolved.value.absolutePath);
    if (!stats.isFile()) {
      return err(new TypedError.NotFound(`File not found: ${filePath}`));
    }
    modifiedAt = stats.mtimeMs;
  } catch (error) {
    return err(
      new TypedError.NotFound(`File not found: ${filePath}`, { cause: error }),
    );
  }

  return ok({
    filename,
    filePath,
    mimeType,
    modifiedAt,
  });
}
