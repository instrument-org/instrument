import { type BrowserTargetId, parseBrowserTargetId } from "../../types";
import { actsIn, owePopup, tabOfPage } from "../tab-activity";
import { getWorkspaceConfig } from "../workspace-config";
import { noteOpenedTab } from "./chat-tabs";
import { closeTabsOverCap } from "./tab-cap";

/**
 * A page an agent drives asked for a window of its own (`window.open`), which
 * the app opens as a tab of the chat behind whatever is up, under `tabId`.
 * It is the work of the session that last acted in the tab whose page opened it:
 * kept at once as a tab that session opened, so it closes and counts toward
 * the chat's cap as any other, and named in that session's next result. A
 * page no session has acted in is the person's, and so is what it opens.
 */
export function notePageOpenedTab(
  from: BrowserTargetId,
  { tabId, url }: { tabId: string; url: string },
): void {
  const fromTab = tabOfPage(from);
  const [opener] = actsIn(fromTab);
  const targetId = parseBrowserTargetId(tabId);
  if (!opener || targetId === null) {
    return;
  }
  owePopup(opener.sessionId, { from: fromTab, tabId, url });
  const { captureException } = getWorkspaceConfig();
  void noteOpenedTab(opener.chatId, targetId, opener.sessionId)
    .then(() => closeTabsOverCap(opener.chatId))
    .catch(captureException);
}
