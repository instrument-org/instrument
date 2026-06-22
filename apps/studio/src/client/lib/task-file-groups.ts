import { TASK_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";

import { filenameFromFilePath } from "./path-utils";

/**
 * Dirs that should surface prominently in the explorer and files grid.
 * Files in any other top-level dir are collapsed into an "Other" section.
 */
const PROMINENT_TOP_LEVEL_DIRS = new Set([
  TASK_FOLDER_NAMES.output,
  TASK_FOLDER_NAMES.userProvided,
]);

export function isUnknownTopLevelDirFile(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.length < 2) {
    return false;
  }
  return !PROMINENT_TOP_LEVEL_DIRS.has(parts[0] as never);
}

const FILTERED_FILENAMES = [
  TASK_MANIFEST_FILE_NAME,
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

export function hasVisibleTaskFiles(
  rawFiles: undefined | { filePath: string }[],
): boolean {
  if (!rawFiles) {
    return false;
  }
  return rawFiles.some((f) => !shouldFilterTaskFile(f.filePath));
}

/**
 * Named root scaffolding files (package.json, lock files, tsconfig, etc.).
 * Unlike shouldFilterTaskFile, this keeps root source files
 * (index.ts, app.tsx, …) visible, so the files grid only demotes config noise.
 */
export function isRootScaffoldingFile(filePath: string): boolean {
  const isRootFile = !filePath.includes("/");
  if (!isRootFile) {
    return false;
  }
  const baseName = filenameFromFilePath(filePath).toLowerCase();
  return FILTERED_FILENAMES.some(
    (filtered) => baseName === filtered.toLowerCase(),
  );
}

export function shouldFilterTaskFile(filePath: string): boolean {
  if (filePath.startsWith("tmp/")) {
    return true;
  }
  const isRootFile = !filePath.includes("/");
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
