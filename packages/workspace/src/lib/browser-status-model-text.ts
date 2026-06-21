import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function browserStatusModelNote(
  data: SessionMessageDataPart.BrowserStatusDataPart,
) {
  if (data.status === "closed") {
    const previousPage = data.previousTarget
      ? ` Last known URL: ${data.previousTarget.url}.${data.previousTarget.title ? ` Page title: ${data.previousTarget.title}.` : ""}`
      : "";
    return systemNote`
      This session previously used \`agent-browser\`, but its in-app browser tab is no longer open.${previousPage} If browser work needs to continue, reopen the relevant page and restore any required page state before proceeding.
    `;
  }

  const title = data.target.title ? ` Page title: ${data.target.title}.` : "";
  return systemNote`
    \`agent-browser\` already has an in-app browser tab open for this task. Current URL: ${data.target.url}.${title}
  `;
}
