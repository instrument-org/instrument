import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a permission answer wakes the agent with: what the person said
 * to the card its work raised, and what to do now, since nobody typed.
 */
export function permissionAnswerModelNote(
  data: SessionMessageDataPart.PermissionAnswerDataPart,
): string {
  if (data.kind === "tab") {
    return systemNote`${tabAnswer(data)}`;
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

/** What the person did with a tab of theirs the agent asked to work in. */
function tabAnswer({
  answer,
  page,
  target,
}: SessionMessageDataPart.PermissionAnswerDataPart): string {
  const named = page
    ? `tab ${target} ("${page.title || page.url}")`
    : `tab ${target}`;
  switch (answer) {
    case "declined": {
      return `The user kept ${named} for themselves.${page ? ` Open ${page.url} in a tab of your own if the work still needs the page; it has their sign-ins, not what they had typed or scrolled to.` : ""}`;
    }
    case "gone": {
      return `${named.charAt(0).toUpperCase()}${named.slice(1)} closed before the user answered.`;
    }
    default: {
      return `The user moved ${named} into this chat, the page as they left it. It is this chat's now: agent-browser works in it, and \`instrument task new --tab ${target}\` hands it to a task.`;
    }
  }
}
