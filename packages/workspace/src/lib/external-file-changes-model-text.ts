import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function externalFileChangesModelNote(
  data: SessionMessageDataPart.ExternalFileChangesDataPart,
): null | string {
  if (data.files.length === 0) {
    return null;
  }

  const lines = data.files
    .map((file) => `- ${file.filePath} (${file.status})`)
    .join("\n");

  return systemNote`
    These files changed on disk outside this session since your last activity (e.g. edited by the user or another tool). Re-read them if relevant before relying on their contents.
    ${lines}
  `;
}
