import path from "node:path";

import {
  type AbsolutePath,
  AbsolutePathSchema,
  type RelativePath,
} from "../schemas/paths";

export function resolvePathWithinAppDir(
  appDir: AbsolutePath,
  filePath: RelativePath,
): AbsolutePath | null {
  const segments = filePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    return null;
  }

  const cleanPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const resolved = path.resolve(appDir, cleanPath);
  const relative = path.relative(appDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return AbsolutePathSchema.parse(resolved);
}
