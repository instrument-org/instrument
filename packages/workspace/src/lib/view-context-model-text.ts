import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * What the user had on screen when they sent the message: the page in the
 * window's browser when that tab was showing, else the folder in the folder
 * view and anything selected in it. "This page", "this folder", "here", and
 * "these" mean what is named here, so a request that points at the screen
 * needs no address or path typed out.
 */
export function viewContextModelNote(
  data: SessionMessageDataPart.ViewContextDataPart,
) {
  const { page } = data;
  if (!page) {
    return systemNote`
      When the user sent this, ${folderShown(data)}. "This folder", "here", "in here" and "these" refer to that. ${folderReach(data)}
    `;
  }
  const title = page.title ? ` "${page.title}"` : "";
  const words = page.selection
    ? `Selected on it: "${page.selection}".`
    : page.text
      ? `It begins: "${page.text}".`
      : "It has no text yet.";
  const tab = page.tab ? ` (tab ${page.tab})` : "";
  const others = (page.tabs ?? []).filter((other) => other.id !== page.tab);
  const tabs =
    others.length > 0
      ? `Other tabs open: ${others.map((other) => `"${other.title || other.url}" at ${other.url} (tab ${other.id})`).join("; ")}.`
      : "No other tabs are open.";
  return systemNote`
    When the user sent this, the browser showed${title} at ${page.url}${tab}. "This page", "this site", "this" and "here" refer to it. Your own agent-browser drives this tab, for one-step things on it; a task that should work in it gets it with --tab and its id, and then drives it in the user's sight. Answer from what is quoted here when that is enough. ${words}
    ${tabs}
    Behind the browser, ${folderShown(data)}; "this folder" means that. ${folderReach(data)}
  `;
}

/** Whether the agent can get at that folder, and how. */
function folderReach(data: SessionMessageDataPart.ViewContextDataPart) {
  return data.mount
    ? `You reach it at \`${data.mount}\`; a task that should work there gets it with --folder, writable when it should write.`
    : "No folder you were granted covers it, so you cannot read it or hand it to a task: ask for it with request_folder, or the user can allow it from the folder view.";
}

function folderShown(data: SessionMessageDataPart.ViewContextDataPart) {
  const selected =
    data.selected.length > 0
      ? `, with ${data.selected.map((entry) => `\`${entry}\``).join(", ")} selected in it`
      : "";
  return `the folder view showed \`${data.folder}\`${selected}`;
}
