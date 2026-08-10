import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function paneTabsModelNote(
  data: SessionMessageDataPart.PaneTabsDataPart,
) {
  const names = data.tabs.map((tab) =>
    tab.type === "file" ? `\`${tab.filePath}\`` : "the browser",
  );

  return systemNote`
    The panel beside the conversation already has these open: ${names.join(", ")}. \`show\` focuses a tab that is already open rather than adding a second one, so there is no need to re-show any of these.
  `;
}
