import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * What the user had on screen when they sent the message: the folder in the
 * window's folder view, and anything selected in it. "This folder", "here",
 * and "these" mean what is named here, so a request that points at the screen
 * needs no path typed out.
 */
export function viewContextModelNote(
  data: SessionMessageDataPart.ViewContextDataPart,
) {
  const selected =
    data.selected.length > 0
      ? `Selected in it: ${data.selected.map((entry) => `\`${entry}\``).join(", ")}.`
      : "Nothing is selected in it.";
  return systemNote`
    When the user sent this, the folder view showed \`${data.folder}\`. ${selected} "This folder", "here", "in here" and "these" refer to that; a task that should put results there gets it with --folder, writable.
  `;
}
