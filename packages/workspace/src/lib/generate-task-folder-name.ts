import { type AbsolutePath } from "../schemas/paths";
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import { absolutePathJoin } from "./absolute-path-join";
import { findAvailableName } from "./find-available-name";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";
import { taskFolderSlug } from "./task-folder-slug";

// Derives a sibling folder name for a branch by reusing the source folder's
// base and taking the next free trailing integer, so `2026-06-23-add-toggle`
// -> `2026-06-23-add-toggle-2` and `…-2` -> `…-3` (the existing suffix is
// bumped rather than nested into `…-2-2`). Keeps branches grouped next to their
// source on disk. Returns the chosen `suffix` too so the display name can share
// the same counter.
export async function generateBranchFolderName({
  sourceFolderName,
  tasksDir,
}: {
  sourceFolderName: string;
  tasksDir: AbsolutePath;
}) {
  const base = sourceFolderName.replace(/-\d+$/, "");

  const { name, renamed } = await findAvailableName({
    isTaken: (candidate) => pathExists(absolutePathJoin(tasksDir, candidate)),
    name: base,
  });
  // Recover the appended counter for the display name; bare base = suffix 1.
  // `base` had any prior `-N` stripped, so the trailing number is unambiguous.
  const suffix = renamed ? Number(name.slice(base.length + 1)) : 1;

  return { name: SubdomainPartSchema.parse(name), suffix };
}

// Sortable, human-readable name used as the on-disk task id (e.g.
// "2026-06-23-add-a-dark-mode-toggle"). Falls back to "task" when the prompt
// yields no usable slug, and appends a numeric suffix on collision.
export async function generateTaskFolderName({
  prompt,
  tasksDir,
}: {
  prompt?: string;
  tasksDir: AbsolutePath;
}) {
  const slug = (prompt && taskFolderSlug(prompt)) || "task";
  const base = `${formatDatePrefix(getCurrentDate())}-${slug}`;

  const { name } = await findAvailableName({
    isTaken: (candidate) => pathExists(absolutePathJoin(tasksDir, candidate)),
    name: base,
  });

  return SubdomainPartSchema.parse(name);
}

function formatDatePrefix(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
