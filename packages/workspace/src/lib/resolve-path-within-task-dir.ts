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

  // Compare against a whole `..` segment, not the `..` prefix: a file legitimately
  // named `..foo` relativizes to `..foo` and is inside the dir.
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return AbsolutePathSchema.parse(resolvedPath);
}
