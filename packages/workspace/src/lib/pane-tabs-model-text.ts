import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function paneTabsModelNote(
  data: SessionMessageDataPart.PaneTabsDataPart,
) {
  // Said plainly rather than by omission. This note supersedes an earlier one
  // naming open files, and both stay in the history the model reads, so the
  // later note has to contradict the earlier one outright.
  if (data.tabs.length === 0) {
    return systemNote`
      The panel beside the conversation no longer has anything open. Nothing named earlier is still on screen.
    `;
  }

  const names = data.tabs.map((tab) =>
    tab.type === "file" ? `\`${tab.filePath}\`` : "the browser",
  );

  return systemNote`
    The panel beside the conversation already has these open: ${names.join(", ")}. \`show\` focuses a tab that is already open rather than adding a second one, so there is no need to re-show any of these.
  `;
}
