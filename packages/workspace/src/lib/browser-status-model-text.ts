import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function browserStatusModelNote(
  data: SessionMessageDataPart.BrowserStatusDataPart,
) {
  if (data.tabs.length === 0) {
    return systemNote`
      Your browser has no tabs of the user's chat now.
    `;
  }

  const tabs = data.tabs
    .map(
      (tab) =>
        `${tab.id} at ${tab.url}${tab.title ? ` ("${tab.title}")` : ""}${tab.openedBy === "handed" ? ", handed to you: it is the user's, so work in it and never close it" : ", which you opened"}`,
    )
    .join("; ");
  return systemNote`
    Your browser is these tabs of the user's chat, first one first: ${tabs}. \`agent-browser\` starts on the first; \`agent-browser tab <id>\` switches to another, and \`agent-browser tab list\` shows them all.
  `;
}
