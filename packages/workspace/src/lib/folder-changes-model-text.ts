import { MOUNT } from "../mount-points";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { folderMountPoint } from "./folder-mounts";
import { folderLabel } from "./folder-parent-label";
import { systemNote } from "./system-note";

/**
 * What changed about the folders granted in the chat since the model last
 * looked.
 *
 * Each folder is named the way the user names it, with its mount path beside it
 * as the address that changed. A rename here is a rename of the mount, which
 * happens for reasons on our side: saying so plainly is what stops the model
 * telling the user their folder was renamed.
 */
export function folderChangesModelNote(
  data: SessionMessageDataPart.FolderChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.added.length > 0) {
    const added = data.added
      .map(
        (folder) =>
          `- "${folderLabel(folder.path)}" -> \`${folderMountPoint(folder.name)}\` (${folder.access === "read-write" ? "read and write" : "read-only"})`,
      )
      .join("\n");
    lines.push(
      `You have been given these folders since your last activity. They are mounted and ready to read now, alongside the ones your folders context lists:\n${added}`,
    );
  }

  if (data.removed.length > 0) {
    const removed = data.removed
      .map(
        (folder) =>
          `- "${folderLabel(folder.path)}" (was mounted at \`${folderMountPoint(folder.name)}\`)`,
      )
      .join("\n");
    lines.push(
      `These folders were taken back from this chat since your last activity. Their ${MOUNT.folders} mounts are gone, so do not attempt to read or search them:\n${removed}`,
    );
  }

  if (data.renamed.length > 0) {
    const renamed = data.renamed
      .map(
        (folder) =>
          `- "${folderLabel(folder.path)}": now \`${folderMountPoint(folder.newName)}\`, was \`${folderMountPoint(folder.oldName)}\``,
      )
      .join("\n");
    lines.push(
      `These folders are mounted at a new path. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:\n${renamed}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return systemNote`
    ${lines.join("\n\n")}
  `;
}
