import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";

/**
 * The only dirs surfaced to the user. Everything else -- the agent's `work/`
 * project, scaffolding, scratch -- is hidden.
 */
const PROMINENT_TOP_LEVEL_DIRS = new Set([
  TASK_FOLDER_NAMES.attachments,
  TASK_FOLDER_NAMES.downloads,
  TASK_FOLDER_NAMES.output,
]);

export function hasVisibleTaskFiles(
  rawFiles: undefined | { filePath: string }[],
): boolean {
  if (!rawFiles) {
    return false;
  }
  return rawFiles.some((f) => !shouldFilterTaskFile(f.filePath));
}

/**
 * Hide anything that is not under a prominent top-level dir (`attachments/`,
 * `output/`). Root files and everything inside `work/` are filtered out.
 */
export function shouldFilterTaskFile(filePath: string): boolean {
  const dir = topLevelDir(filePath);
  return dir === undefined || !PROMINENT_TOP_LEVEL_DIRS.has(dir as never);
}

function topLevelDir(filePath: string): string | undefined {
  const parts = filePath.split("/");
  return parts.length < 2 ? undefined : parts[0];
}
