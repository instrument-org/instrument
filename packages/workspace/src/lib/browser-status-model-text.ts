import type { SessionMessageDataPart } from "../schemas/session/message-data-part";

import { systemNote } from "./system-note";

export function browserStatusModelNote(
  data: SessionMessageDataPart.BrowserStatusDataPart,
): string {
  if (data.hasLiveView) {
    const url = data.pageUrl ?? "(unknown)";
    const titleSuffix = data.pageTitle ? ` Page title: ${data.pageTitle}.` : "";
    return systemNote`
      \`agent-browser\` already has a live in-app browser tab for this chat session. Current URL: ${url}.${titleSuffix}
    `;
  }
  return systemNote`
    No \`agent-browser\` in-app browser tab is open for this chat session yet.
  `;
}
