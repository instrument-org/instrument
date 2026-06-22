import path from "node:path";

import {
  type AbsolutePath,
  AbsolutePathSchema,
  type RelativePath,
  type TaskDir,
} from "../schemas/paths";
import { normalizePath } from "./normalize-path";

export function resolvePathWithinTaskDir({
  dir,
  filePath,
}: {
  dir: TaskDir;
  filePath: RelativePath;
}): AbsolutePath | null {
  const normalizedFilePath = normalizePath(filePath);
  const resolvedPath = path.resolve(dir, normalizedFilePath);
  const relativePath = path.relative(dir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return AbsolutePathSchema.parse(resolvedPath);
}
