import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { type WorkspaceFilePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { TypedError } from "./errors";
import { getMimeType } from "./get-mime-type";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";

export async function getCurrentFileInfo({
  filePath,
  taskId,
}: {
  filePath: WorkspaceFilePath;
  taskId: ChatId;
}) {
  const filename = path.basename(filePath);
  const mimeType = getMimeType(filename);

  if (!filename) {
    return err(new TypedError.NotFound("File path has no filename"));
  }

  const resolvedPath = await resolveWorkspaceFilePath({ filePath, taskId });
  if (!resolvedPath) {
    return err(new TypedError.NotFound(`File not found: ${filePath}`));
  }

  let modifiedAt: number;
  try {
    const stats = await fs.stat(resolvedPath);
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
    hostPath: resolvedPath,
    mimeType,
    modifiedAt,
  });
}
