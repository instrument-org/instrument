import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";

/**
 * The dirs surfaced to the user. Nested content elsewhere -- the agent's
 * `work/` project, scaffolding, scratch -- is hidden. Root-level files are also
 * surfaced (see `shouldFilterTaskFile`).
 */
const PROMINENT_TOP_LEVEL_DIRS = new Set<string>([
  TASK_FOLDER_NAMES.attachments,
  TASK_FOLDER_NAMES.downloads,
  TASK_FOLDER_NAMES.output,
]);

/**
 * Hide anything that is not under a prominent top-level dir (`attachments/`,
 * `downloads/`, `output/`) and is not a root-level file. Root files are
 * surfaced (dotfiles excluded) so a deliverable an agent saved to the task root
 * (instead of `output/`) is still shown; nested scratch inside `work/` stays
 * hidden.
 */
export function shouldFilterTaskFile(filePath: string): boolean {
  const dir = topLevelDir(filePath);
  if (dir === undefined) {
    // A root-level path is just its filename. Surface it, except dotfiles like
    // the `.gitignore` written during task setup, which stay hidden.
    return filePath.startsWith(".");
  }
  return !PROMINENT_TOP_LEVEL_DIRS.has(dir);
}

function topLevelDir(filePath: string): string | undefined {
  const parts = filePath.split("/");
  return parts.length < 2 ? undefined : parts[0];
}
