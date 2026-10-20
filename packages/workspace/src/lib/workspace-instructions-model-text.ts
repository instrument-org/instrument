import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function workspaceInstructionsModelNote({
  file,
  instructions,
}: SessionMessageDataPart.WorkspaceInstructionsDataPart): string {
  if (!instructions) {
    return systemNote`The workspace instructions in \`${file}\` are empty or removed. Stop applying the previous workspace instructions.`;
  }
  return systemNote`The user's standing instructions for every chat and task in this workspace, from \`${file}\`. This snapshot replaces the previous workspace instructions. Follow them for this work; topic instructions are more specific, and the user's direct requests take precedence.
<workspace_instructions>
${instructions}
</workspace_instructions>`;
}
