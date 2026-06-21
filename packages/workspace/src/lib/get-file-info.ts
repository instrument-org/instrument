import { err, ok } from "neverthrow";
import path from "node:path";
import { z } from "zod";

import { type RelativePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { TypedError } from "./errors";
import { getMimeType } from "./get-mime-type";
import { normalizeProjectFilePath } from "./normalize-project-file-path";
import { urlsForSubdomain } from "./url-for-subdomain";

export const CurrentFileInfoSchema = z.object({
  filename: z.string(),
  filePath: z.string(),
  mimeType: z.string(),
  url: z.string(),
});

export function getCurrentFileInfo({
  filePath,
  projectSubdomain,
}: {
  filePath: RelativePath;
  projectSubdomain: TaskId;
}) {
  const urls = urlsForSubdomain(projectSubdomain);
  const cleanPath = normalizeProjectFilePath(filePath);
  const url = `${urls.assetBase}/${cleanPath}`;

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
