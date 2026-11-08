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

/** Where a taken tab came from: the Browser tab that showed it, while it has shown nothing since. */
interface TakenFrom {
  browserTab: TabId;
  /** Set once the Browser tab goes anywhere after its start. */
  moved: boolean;
  site: string;
  stop: () => void;
}

/**
 * The tabs taken into a draft, by id, with where each came from. Kept in
 * memory only, so a relaunch forgets them and a tab never goes back
 * anywhere long after.
 */
const takenFrom = new Map<string, TakenFrom>();

/**
 * Moves a page tab of the person's own into a chat's or draft's group, guest
 * and all, so what is typed in its page, where it is scrolled to and its
 * history come along. The Browser tab that showed it goes back to its start,
 * still a browser of the person's, and is remembered, so the tab can go back
 * there (`putBackTakenTab`). Nothing is selected or put up. Answers the tab
 * moved, or undefined when the id names no tab of the person's.
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
  const router = shownIn ? getTabRouter(shownIn.id) : undefined;
  if (shownIn && router && site !== undefined) {
    router.history.replace(BROWSER_HREF);
    forgetTakenTab(theirs.id);
    const from: TakenFrom = {
      browserTab: shownIn.id,
      moved: false,
      site,
      stop: () => undefined,
    };
    // Anywhere the Browser tab goes after its start is somewhere the page
    // would not be looked for.
    from.stop = router.history.subscribe(() => {
      from.moved = true;
    });
    takenFrom.set(theirs.id, from);
  }
  windowTabs.moveToGroup(theirs.id, group);
  return theirs;
}

/**
 * Puts a tab taken into a draft back into the Browser tab it came from, guest
 * and all, when that Browser tab is still at the start it was left on: the
 * person took the page's chip out, or threw the draft away. Answers whether
 * it went back; a tab that did not is the caller's to close.
 */
export function putBackTakenTab({
  tabId,
  windowTabs,
}: {
  tabId: string;
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "moveToGroup">;
}): boolean {
  const from = takenFrom.get(tabId);
  forgetTakenTab(tabId);
  const router = from ? getTabRouter(from.browserTab) : undefined;
  if (
    !from ||
    !router ||
    from.moved ||
    router.history.location.href !== BROWSER_HREF
  ) {
    return false;
  }
  windowTabs.moveToGroup(tabId, from.site);
  router.history.replace(pageHrefOf(from.site));
  return true;
}

/** Forgets where a taken tab came from, as it goes on with its draft to a chat. */
export function forgetTakenTab(tabId: string): void {
  takenFrom.get(tabId)?.stop();
  takenFrom.delete(tabId);
}
