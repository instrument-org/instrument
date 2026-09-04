import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { TaskPane } from "../schemas/task-pane";
import { systemNote } from "./system-note";

const BROWSER_TAB: TaskPane.Tab = { type: "browser" };

/**
 * What the pane is showing, said the way the user sees it: closed or open,
 * one tab in front, the rest a click away behind it.
 *
 * Every state is said plainly rather than by omission. A note here supersedes
 * an earlier one, and both stay in the history the model reads, so the later
 * note has to contradict the earlier one outright: a pane that closed has to
 * say that nothing is on screen, not merely stop listing things.
 */
export function paneTabsModelNote(
  data: SessionMessageDataPart.PaneTabsDataPart,
) {
  const files = data.tabs.filter((tab) => tab.type === "file");

  if (!data.open) {
    if (files.length === 0) {
      return systemNote`
        The panel beside the conversation is closed and holds no file tabs. Nothing named earlier is on screen.
      `;
    }
    return systemNote`
      The panel beside the conversation is closed, so nothing named earlier is on screen. It still holds tabs for ${files.map(name).join(", ")}; \`show\` on one of those reopens the panel on that tab rather than adding a second one.
    `;
  }

  const front = TaskPane.frontTab(data);
  const frontKey = TaskPane.tabKey(front);
  // The browser is a tab the pane always draws, so whenever a file is in
  // front the browser is behind it, whether or not it has ever shown a page.
  const behind = [
    ...files.filter((tab) => TaskPane.tabKey(tab) !== frontKey),
    ...(front.type === "browser" ? [] : [BROWSER_TAB]),
  ].map(name);

  if (behind.length === 0) {
    return systemNote`
      The panel beside the conversation is open, showing the browser, and holds no file tabs. No file named earlier is on screen.
    `;
  }

  return systemNote`
    The panel beside the conversation is open, showing ${name(front)}. Behind it, a click away: ${behind.join(", ")}. \`show\` brings one of those to the front rather than adding a second tab, and what is in front needs no showing.
  `;
}

function name(tab: TaskPane.Tab): string {
  return tab.type === "file" ? `\`${tab.filePath}\`` : "the browser";
}
