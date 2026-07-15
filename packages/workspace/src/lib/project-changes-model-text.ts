import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function projectChangesModelNote(
  data: SessionMessageDataPart.ProjectChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.instructionsChanged) {
    lines.push(
      data.instructions
        ? `The instructions for the "${data.projectName}" project were updated. This is the current version; follow it going forward, and disregard the earlier project instructions:\n\n${data.instructions}`
        : `The instructions for the "${data.projectName}" project were cleared. Disregard the earlier project instructions.`,
    );
  }

  if (data.foldersAdded.length > 0) {
    const added = data.foldersAdded
      .map((folder) => `- ${folder.name}`)
      .join("\n");
    lines.push(
      `These folders were added to the "${data.projectName}" project and are now mounted read-only under /mnt/ (the attached-folders context lists the exact paths):\n${added}`,
    );
  }

  if (data.foldersRemoved.length > 0) {
    const removed = data.foldersRemoved
      .map((folder) => `- ${folder.name}`)
      .join("\n");
    lines.push(
      `These folders were removed from the "${data.projectName}" project and are no longer mounted, so do not attempt to read or search them:\n${removed}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return systemNote`
    ${lines.join("\n\n")}
  `;
}
