import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";

// Only `output/` (deliverables), `attachments/` (user inputs), `downloads/`
// (agent-fetched files), and root-level files surface to the user. Nested
// scratch inside the agent's `work/` project stays hidden.
const SURFACED_FOLDERS = [
  TASK_FOLDER_NAMES.output,
  TASK_FOLDER_NAMES.attachments,
  TASK_FOLDER_NAMES.downloads,
];

export function isFileInTaskFolder(filePath: string, folderName: string) {
  return filePath.startsWith(`${folderName}/`);
}

export function isRootTaskFile(filePath: string) {
  // Root-level, non-dotfile: surfaces a deliverable saved to the task root while
  // hiding setup dotfiles like `.gitignore`.
  return !filePath.includes("/") && !filePath.startsWith(".");
}

export function isSurfacedTaskFile(filePath: string) {
  return (
    SURFACED_FOLDERS.some((folderName) =>
      isFileInTaskFolder(filePath, folderName),
    ) || isRootTaskFile(filePath)
  );
}
