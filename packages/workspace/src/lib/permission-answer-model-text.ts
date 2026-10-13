import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a permission answer wakes the agent with: what the person said
 * to the card its work raised, and what to do now, since nobody typed.
 */
export function permissionAnswerModelNote(
  data: SessionMessageDataPart.PermissionAnswerDataPart,
): string {
  const what = data.kind === "app" ? data.target : `the folder ${data.target}`;
  const said =
    data.answer === "declined"
      ? `The person said not now to ${what}. Carry on without it, and say in a line what you skipped because of it.`
      : `The person allowed ${what}${data.answer === "always" ? " for every chat" : " in this chat"}. Run again what needed it.`;
  return systemNote`${said}`;
}
