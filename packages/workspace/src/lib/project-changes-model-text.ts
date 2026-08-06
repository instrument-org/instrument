import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { normalizeProjectInstructions } from "./project-instructions";
import { systemNote } from "./system-note";

export function projectChangesModelNote(
  data: SessionMessageDataPart.ProjectChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.instructionsChanged) {
    // Capped again on the way out: parts written before the cap existed hold the
    // whole file, and this note carries the instructions in full.
    const instructions = normalizeProjectInstructions(data.instructions ?? "");
    lines.push(
      instructions
        ? `The instructions for the "${data.projectName}" project were updated. This is the current version; follow it going forward, and disregard the earlier project instructions:\n\n${instructions}`
        : `The instructions for the "${data.projectName}" project were cleared. Disregard the earlier project instructions.`,
    );
  }

  if (data.foldersAdded.length > 0) {
    // A folder new to this task is not in the attached-folders baseline, so
    // detectAttachedFolderChanges cannot report its access. This is the only
    // per-turn announcement it gets, and it has to carry what the mount allows.
    const added = data.foldersAdded
      .map(
        (folder) =>
          `- ${folder.name} (${folder.access === "read-write" ? "read and write" : "read-only"})`,
      )
      .join("\n");
    lines.push(
      `These folders were added to the "${data.projectName}" project and are now mounted under /mnt/ with the access shown (the attached-folders context lists the exact paths):\n${added}`,
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
