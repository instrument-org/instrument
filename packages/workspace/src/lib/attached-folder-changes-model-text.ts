import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function attachedFolderRemovalsModelNote(
  data: SessionMessageDataPart.AttachedFolderChangesDataPart,
): null | string {
  if (data.removed.length === 0) {
    return null;
  }

  const lines = data.removed
    .map((folder) => `- ${folder.name}`)
    .join("\n");

  return systemNote`
    The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them.
    ${lines}
  `;
}
