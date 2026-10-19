import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { folderLabel } from "./folder-parent-label";
import { systemNote } from "./system-note";
import { shellPath } from "./workspace-fs-layout";

/**
 * What changed about the folders granted in the chat since the model last
 * looked.
 *
 * Each folder is named the way the user names it, with its path beside it.
 */
export function folderChangesModelNote(
  data: SessionMessageDataPart.FolderChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.added.length > 0) {
    const added = data.added
      .map(
        (folder) =>
          `- "${folderLabel(folder.path)}" at ${shellPath(folder.path)}`,
      )
      .join("\n");
    lines.push(
      `You have been given these folders since your last activity. They are ready to read now, alongside the ones your folders context lists:\n${added}`,
    );
  }

  if (data.removed.length > 0) {
    const removed = data.removed
      .map(
        (folder) =>
          `- "${folderLabel(folder.path)}" at ${shellPath(folder.path)}`,
      )
      .join("\n");
    lines.push(
      `These folders were taken back from this chat since your last activity, so do not attempt to read or search them:\n${removed}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return systemNote`
    ${lines.join("\n\n")}
  `;
}
