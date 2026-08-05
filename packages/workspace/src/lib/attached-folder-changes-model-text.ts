import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function attachedFolderChangesModelNote(
  data: SessionMessageDataPart.AttachedFolderChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.removed.length > 0) {
    const removed = data.removed.map((folder) => `- ${folder.name}`).join("\n");
    lines.push(
      `The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:\n${removed}`,
    );
  }

  if (data.renamed.length > 0) {
    const renamed = data.renamed
      .map((folder) => `- ${folder.oldName} -> ${folder.newName}`)
      .join("\n");
    lines.push(
      `These attached folders were renamed because another attached folder now shares their old name. Use the new name and its /mnt path instead of any old one you referenced earlier:\n${renamed}`,
    );
  }

  if (data.accessChanged.length > 0) {
    const changed = data.accessChanged
      .map(
        (folder) =>
          `- ${folder.name}: now ${folder.access === "read-write" ? "read and write" : "read-only"}`,
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
