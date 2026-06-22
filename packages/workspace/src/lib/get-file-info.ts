import { err, ok } from "neverthrow";
import path from "node:path";
import { z } from "zod";

import { type RelativePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { TypedError } from "./errors";
import { getMimeType } from "./get-mime-type";
import { normalizeTaskFilePath } from "./normalize-task-file-path";
import { assetBaseUrl } from "./url-for-subdomain";

export const CurrentFileInfoSchema = z.object({
  filename: z.string(),
  filePath: z.string(),
  mimeType: z.string(),
  url: z.string(),
});

export function getCurrentFileInfo({
  filePath,
  taskId,
}: {
  filePath: RelativePath;
  taskId: TaskId;
}) {
  const cleanPath = normalizeTaskFilePath(filePath);
  const url = `${assetBaseUrl(taskId)}/${cleanPath}`;

  const filename = path.basename(filePath);
  const mimeType = getMimeType(filename);

  if (!filename) {
    return err(new TypedError.NotFound("File path has no filename"));
  }

  return ok({
    filename,
    filePath,
    mimeType,
    url,
  });
}
