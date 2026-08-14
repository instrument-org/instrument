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
      This session previously had an in-app browser tab open, but it is no longer open.${previousPage} If browser work needs to continue, use \`agent-browser\` to reopen the relevant page and restore any required page state before proceeding.
    `;
  }

  const title = data.target.title ? ` Page title: ${data.target.title}.` : "";

  if (data.status === "reopened") {
    return systemNote`
      The in-app browser tab for this session was closed while it sat idle, and has been reopened at the page it was last on. Current URL: ${data.target.url}.${title} It is a fresh load, so anything the page was holding -- scroll position, form entries, expanded sections, snapshot refs -- is gone. Re-establish whatever state the work needs before acting on it.
    `;
  }

  return systemNote`
    An in-app browser tab is already open for this task (opened by you or the user). Current URL: ${data.target.url}.${title} Drive it with \`agent-browser\`.
  `;
}
