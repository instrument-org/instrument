import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a permission answer wakes the agent with: what the person said
 * to the card its work raised, and what to do now, since nobody typed.
 */
export function permissionAnswerModelNote(
  data: SessionMessageDataPart.PermissionAnswerDataPart,
): string {
  if (data.kind === "page") {
    return systemNote`${pageAnswer(data)}`;
  }
  const what = data.kind === "app" ? data.target : `the folder ${data.target}`;
  const said =
    data.answer === "declined"
      ? `The person said not now to ${what}. Carry on without it, and say in a line what you skipped because of it.`
      : data.through === "windows-protection"
        ? `The person let ${APP_NAME} through Windows ransomware protection for ${what}. Run again what needed it.`
        : data.through === "macos"
          ? `macOS now lets ${APP_NAME} into ${what}. Run again what needed it.`
          : `The person allowed ${what}${data.answer === "always" ? " for every chat" : " in this chat"}. Run again what needed it.`;
  return systemNote`${said}`;
}

/** What the person did on a page of the chat's the agent waited on them in. */
function pageAnswer({
  answer,
  page,
  target,
}: SessionMessageDataPart.PermissionAnswerDataPart): string {
  const now = page
    ? ` It is now at ${page.url}${page.title ? ` ("${page.title}")` : ""}.`
    : "";
  return answer === "declined"
    ? `The user skipped what you waited on them for in tab ${target}.${now} Carry on without it, and say in a line what that left out.`
    : `The user pressed Done on tab ${target}.${now} Look at the page before going on, since Done says only that they finished.`;
}
