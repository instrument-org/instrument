import path from "node:path";

import { type FolderAttachment } from "../schemas/folder-attachment";

// How many ancestor directory names to fold into the candidate before giving
// up and falling back to a numeric suffix.
const MAX_PARENT_SEGMENTS = 3;

/**
 * Pick a folder-attachment name not already used by `folders` (keyed by
 * name), for the folder at `folderPath`.
 *
 * On collision, this prepends the folder's ancestor directory names one at a
 * time (e.g. "Downloads" -> "CloudDocs-Downloads" -> "Mobile Documents-CloudDocs-Downloads")
 * rather than an opaque counter, so two identically-named folders read as
 * distinguishable to both the user and the agent. If ancestors run out or the
 * qualified name still collides after {@link MAX_PARENT_SEGMENTS} levels, it
 * falls back to suffixing "-1", "-2", ... on the deepest attempt.
 *
 * Every writer of task-state attachedFolders must route new names through
 * this, because unique names are the invariant that makes a folder's /mnt
 * mount path (see attached-folder-mounts.ts) derivable from its name alone,
 * everywhere it is displayed.
 */
export function uniqueFolderName(
  folderPath: string,
  folders: Record<string, FolderAttachment.Type>,
): string {
  const baseName = path.basename(folderPath) || folderPath;
  let candidate = baseName;
  if (!Object.hasOwn(folders, candidate)) {
    return candidate;
  }

  let dir = folderPath;
  for (let i = 0; i < MAX_PARENT_SEGMENTS; i++) {
    const parentDir = path.dirname(dir);
    const segment = path.basename(parentDir);
    if (!segment || parentDir === dir) {
      break;
    }
    candidate = `${segment}-${candidate}`;
    if (!Object.hasOwn(folders, candidate)) {
      return candidate;
    }
    dir = parentDir;
  }

  let counter = 1;
  let suffixed = `${candidate}-${counter}`;
  while (Object.hasOwn(folders, suffixed)) {
    counter++;
    suffixed = `${candidate}-${counter}`;
  }
  return suffixed;
}
