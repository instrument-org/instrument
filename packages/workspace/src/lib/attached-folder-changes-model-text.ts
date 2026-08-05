import { folderNameFromPath } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { attachedFolderMountPoint } from "./attached-folder-mounts";
import { systemNote } from "./system-note";

/**
 * What changed about this task's attached folders since the model last looked.
 *
 * Each folder is named the way the user names it, with its mount path beside it
 * as the address that changed. A rename here is a rename of the mount, which
 * happens for reasons on our side: saying so plainly is what stops the model
 * telling the user their folder was renamed.
 */
export function attachedFolderChangesModelNote(
  data: SessionMessageDataPart.AttachedFolderChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.removed.length > 0) {
    const removed = data.removed
      .map(
        (folder) =>
          `- "${folderNameFromPath(folder.path)}" (was mounted at \`${attachedFolderMountPoint(folder.name)}\`)`,
      )
      .join("\n");
    lines.push(
      `The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:\n${removed}`,
    );
  }

  if (data.renamed.length > 0) {
    const renamed = data.renamed
      .map(
        (folder) =>
          `- "${folderNameFromPath(folder.path)}": now \`${attachedFolderMountPoint(folder.newName)}\`, was \`${attachedFolderMountPoint(folder.oldName)}\``,
      )
      .join("\n");
    lines.push(
      `These folders are mounted at a new path, because another attachment now shares the name theirs was derived from. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:\n${renamed}`,
    );
  }

  if (data.accessChanged.length > 0) {
    const changed = data.accessChanged
      .map(
        (folder) =>
          `- "${folderNameFromPath(folder.path)}" (\`${attachedFolderMountPoint(folder.name)}\`): now ${folder.access === "read-write" ? "read and write" : "read-only"}`,
      )
      .join("\n");
    lines.push(
      `The user changed what you may do with these attached folders. This supersedes the access level listed in your attached-folders context, which may be older than this message:\n${changed}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return systemNote`
    ${lines.join("\n\n")}
  `;
}
