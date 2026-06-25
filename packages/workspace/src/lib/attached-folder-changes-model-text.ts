import { RETRIEVAL_AGENT_NAME } from "../agents/types";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function attachedFolderRemovalsModelNote(
  data: SessionMessageDataPart.AttachedFolderChangesDataPart,
): null | string {
  if (data.removed.length === 0) {
    return null;
  }

  const lines = data.removed
    .map((folder) => `- ${folder.name} (${folder.path})`)
    .join("\n");

  return systemNote`
    The user removed these attached folders from this task since your last activity. They are no longer available via the ${RETRIEVAL_AGENT_NAME} agent, so do not attempt to read or search them.
    ${lines}
  `;
}
