import { CODE_EXTENSION_MIME_TYPES } from "@instrument-org/shared";
import mime from "mime-types";
import path from "node:path";

export function getMimeType(filenameOrFilePath: string) {
  const ext = path.extname(filenameOrFilePath).toLowerCase().slice(1);

  const override = CODE_EXTENSION_MIME_TYPES[ext];
  if (override) {
    return override;
  }

  const mimeType = mime.lookup(filenameOrFilePath);

  if (!mimeType) {
    const basename = path.basename(filenameOrFilePath);
    const isDotfile =
      basename.startsWith(".") && !basename.slice(1).includes(".");
    if (!ext || isDotfile) {
      return "text/plain";
    }
    return "application/octet-stream";
  }

  return mimeType;
}
