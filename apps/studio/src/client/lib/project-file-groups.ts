import { PROJECT_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import { APP_FOLDER_NAMES } from "@instrument-org/workspace/client";

import { filenameFromFilePath } from "./path-utils";

/**
 * Dirs that should surface prominently in the explorer and files grid.
 * Files in any other top-level dir are collapsed into an "Other" section.
 */
const PROMINENT_TOP_LEVEL_DIRS = new Set([
  APP_FOLDER_NAMES.output,
  APP_FOLDER_NAMES.userProvided,
]);

export function isUnknownTopLevelDirFile(filePath: string): boolean {
  const parts = filePath.replace(/^\.\//, "").split("/");
  if (parts.length < 2) {
    return false;
  }
  return !PROMINENT_TOP_LEVEL_DIRS.has(parts[0] as never);
}

const FILTERED_FILENAMES = [
  PROJECT_MANIFEST_FILE_NAME,
  "AGENTS.md",
  ".gitignore",
  "eslint.config.js",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "readme.md",
  "tsconfig.json",
  "vite.config.ts",
];

const ROOT_SOURCE_EXTENSIONS = [
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
];

export function hasVisibleProjectFiles(
  rawFiles: undefined | { filePath: string }[],
): boolean {
  if (!rawFiles) {
    return false;
  }
  return rawFiles.some((f) => !shouldFilterProjectFile(f.filePath));
}

export function shouldFilterProjectFile(filePath: string): boolean {
  if (filePath.startsWith("./patches/") || filePath.startsWith("./tmp/")) {
    return true;
  }
  const isRootFile = !filePath.slice(2).includes("/");
  if (!isRootFile) {
    return false;
  }
  const baseName = filenameFromFilePath(filePath).toLowerCase();
  if (
    FILTERED_FILENAMES.some((filtered) => baseName === filtered.toLowerCase())
  ) {
    return true;
  }
  return ROOT_SOURCE_EXTENSIONS.some((ext) => baseName.endsWith(ext));
}
