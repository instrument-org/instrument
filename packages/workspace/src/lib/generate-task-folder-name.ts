import { type AbsolutePath } from "../schemas/paths";
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import { absolutePathJoin } from "./absolute-path-join";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";
import { taskFolderSlug } from "./task-folder-slug";

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

  let candidate = base;
  let suffix = 1;
  while (await pathExists(absolutePathJoin(tasksDir, candidate))) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return SubdomainPartSchema.parse(candidate);
}

function formatDatePrefix(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
