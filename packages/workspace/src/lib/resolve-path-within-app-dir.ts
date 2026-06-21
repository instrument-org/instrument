import path from "node:path";

import {
  type AbsolutePath,
  AbsolutePathSchema,
  type AppDir,
  type RelativePath,
} from "../schemas/paths";
import {
  normalizePath,
} from "./normalize-path";

export function resolvePathWithinAppDir({
  appDir,
  filePath,
}: {
  appDir: AppDir;
  filePath: RelativePath;
}): AbsolutePath | null {
  const normalizedFilePath = normalizePath(filePath);
  const resolvedPath = path.resolve(appDir, normalizedFilePath);
  const relativePath = path.relative(appDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return AbsolutePathSchema.parse(resolvedPath);
}
