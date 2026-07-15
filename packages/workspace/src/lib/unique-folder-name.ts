import { type FolderAttachment } from "../schemas/folder-attachment";

/**
 * Pick a folder-attachment name not already used by `folders` (keyed by name),
 * suffixing "-1", "-2", ... on collision.
 *
 * Every writer of task-state attachedFolders must route new names through
 * this, because unique names are the invariant that makes a folder's /mnt
 * mount path (see attached-folder-mounts.ts) derivable from its name alone,
 * everywhere it is displayed.
 */
export function uniqueFolderName(
  baseName: string,
  folders: Record<string, FolderAttachment.Type>,
): string {
  let candidate = baseName;
  let counter = 1;
  while (candidate in folders) {
    candidate = `${baseName}-${counter}`;
    counter++;
  }
  return candidate;
}
