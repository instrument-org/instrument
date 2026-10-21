import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { folderNameFromPath } from "@instrument-org/shared";

import { systemNote } from "./system-note";
import { shellPath } from "./workspace-fs-layout";

/**
 * What changed about the folders granted in the chat since the model last
 * looked.
 *
 * Each folder is named by its own name, read from its path alone, with its path beside it
 * as the shell spelled it when the note was written; a note from before that
 * was kept is spelled for this computer.
 */
export function folderChangesModelNote(
  data: SessionMessageDataPart.FolderChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.added.length > 0) {
    const added = data.added
      .map(
        (folder) =>
          `- "${folderNameFromPath(folder.path)}" at \`${folder.agentPath ?? shellPath(folder.path)}\``,
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
          `- "${folderNameFromPath(folder.path)}" at \`${folder.agentPath ?? shellPath(folder.path)}\``,
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
