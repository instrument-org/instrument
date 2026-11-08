import { BROWSER_HREF, type WindowTab } from "@/client/atoms/window";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { type TabId } from "@/shared/tabs";

import { isSiteGroup, pageHrefOf } from "./app-tabs";
import { type useWindowTabs } from "./window-tabs";

/** A page tab of the person's own, outside every chat and draft, by its id. */
function personsPageTab(
  allTabs: readonly WindowTab[],
  tabId: string,
): Extract<WindowTab, { kind: "page" }> | undefined {
  const tab = allTabs.find((entry) => entry.id === tabId);
  return tab?.kind === "page" &&
    (tab.group === undefined || isSiteGroup(tab.group))
    ? tab
    : undefined;
}

/**
 * Moves a page tab of the person's own into a chat's or draft's group, guest
 * and all, so what is typed in its page, where it is scrolled to and its
 * history come along. The Browser tab that showed it goes back to its start,
 * still a browser of the person's. Nothing is selected or put up. Answers
 * the tab moved, or undefined when the id names no tab of the person's.
 */
export function takePersonsTab({
  appTabs,
  group,
  tabId,
  windowTabs,
}: {
  /** The window's own tabs, to find the Browser tab showing the page. */
  appTabs: readonly { id: TabId; pathname: string }[];
  group: string;
  tabId: string;
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "allTabs" | "moveToGroup">;
}): Extract<WindowTab, { kind: "page" }> | undefined {
  const theirs = personsPageTab(windowTabs.allTabs, tabId);
  if (!theirs) {
    return undefined;
  }
  const site = theirs.group;
  const shownIn =
    site === undefined
      ? undefined
      : appTabs.find((tab) => tab.pathname === pageHrefOf(site));
  if (shownIn) {
    getTabRouter(shownIn.id)?.history.replace(BROWSER_HREF);
  }
  windowTabs.moveToGroup(theirs.id, group);
  return theirs;
}
