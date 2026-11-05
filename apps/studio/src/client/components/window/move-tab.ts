import { composeAtom } from "@/client/atoms/window";
import { freshTabId } from "@/client/lib/tab-actions";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { captureTabView, tabViewRoot } from "@/client/lib/tab-view-state";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { insertTab, removeTab } from "@/client/lib/tabs-model";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  neighborAt,
  type Tab,
  type TabId,
  type TabMoveDestination,
  type TabStanding,
} from "@/shared/tabs";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

import { appTabsAtom, groupOfHref, INBOX_HREF, siteGroupsOf } from "./app-tabs";
import { showTabCarryView } from "./tab-carry-view";
import { windowTabsAtom } from "./window-tabs";

/** The groups whose tabs went to another window, whose pages are that window's to keep or let go, until a tab comes back. */
const groupsMovedAway = new Set<string>();

export function hasMovedAway(group: string) {
  return groupsMovedAway.has(group);
}

export function forgetMovedAway(group: string) {
  groupsMovedAway.delete(group);
}

/** The sites a tab stands on or can go back to, by its history as its router holds it now. */
function sitesItCanGoTo(tab: Tab) {
  const router = getTabRouter(tab.id);
  const history = router ? getRouterHistory(router) : tab.history;
  return siteGroupsOf([...(history?.entries ?? []), tab.pathname]);
}

/** What handing a tab to another window would hand over, as it stands now. */
export function tabStanding(id: TabId): TabStanding | undefined {
  const store = getDefaultStore();
  const { tabs } = store.get(appTabsAtom);
  const allTabs = store.get(windowTabsAtom).tabs;
  const tab = tabs.find((each) => each.id === id);
  if (!tab) {
    return undefined;
  }
  const router = getTabRouter(id);
  const arrivingView = captureTabView(tabViewRoot(id));
  const moved: Tab = {
    ...tab,
    ...(arrivingView ? { arrivingView } : {}),
    history: router ? getRouterHistory(router) : tab.history,
    pathname: router?.state.location.href ?? tab.pathname,
  };
  const group = groupOfHref(moved.pathname);
  const stillHere = tabs.some(
    (each) => each.id !== id && groupOfHref(each.pathname) === group,
  );
  const pagesOf = (ofGroup: string) =>
    allTabs.flatMap((each) =>
      each.group === ofGroup && each.kind === "page"
        ? [browserTargetOf(each.id)]
        : [],
    );
  const neighbor = neighborAt(
    tabs,
    tabs.findIndex((each) => each.id === id),
  );
  const neighborGroup = neighbor && groupOfHref(neighbor.pathname);
  return {
    neighborPages:
      neighborGroup === undefined || neighborGroup === group
        ? []
        : pagesOf(neighborGroup),
    pages: group === undefined || stillHere ? [] : pagesOf(group),
    tab: moved,
  };
}

/**
 * The tab went to another window with its page: this window lets it go, with
 * nothing of its group to clean up, since that window has it.
 */
export function letTabGo(key: string) {
  const store = getDefaultStore();
  const tab = store.get(appTabsAtom).tabs.find((each) => each.id === key);
  if (!tab) {
    return;
  }
  for (const group of sitesItCanGoTo(tab)) {
    groupsMovedAway.add(group);
  }
  store.set(appTabsAtom, (current) =>
    removeTab(current, {
      id: tab.id,
      newTab: { id: freshTabId(), pathname: INBOX_HREF },
    }),
  );
}

/** The other tabs went to the window left behind, with the floats: this window keeps the one. */
export function keepOnlyTab(key: string) {
  const store = getDefaultStore();
  store.set(appTabsAtom, (current) => {
    const kept = current.tabs.filter((tab) => tab.id === key);
    // Closed while it was held: a window has a tab to show, or it shows nothing.
    const tabs =
      kept.length > 0 ? kept : [{ id: freshTabId(), pathname: INBOX_HREF }];
    return { recentlyClosed: [], selectedId: tabs[0]?.id ?? null, tabs };
  });
  store.set(composeAtom, []);
}

/** An address in a window of its own, beside this one. */
export function openInNewWindow(href: string) {
  void rpcClient.window.openNew.call({
    tab: { id: freshTabId(), pathname: href },
  });
}

/** A tab from another window comes up here, at the place along the strip it was held at. */
export function receiveTab(tab: Tab, index?: number) {
  getDefaultStore().set(appTabsAtom, (current) =>
    insertTab(current, { ...(index === undefined ? {} : { index }), tab }),
  );
}

/** What a window does as a tab's move ends, by a drag let go or from a menu. */
export function settleTabMove(
  key: string,
  end: RPCOutput["window"]["endTabDrag"],
) {
  if (end.kind === "keepsTab") {
    keepOnlyTab(key);
  } else if (end.kind === "takesStrip") {
    getDefaultStore().set(appTabsAtom, end.model);
  } else if (end.kind === "losesTab") {
    letTabGo(key);
  }
  // A window closing goes on showing what it shows until it has gone.
  if (end.kind !== "closes") {
    showTabCarryView({ kind: "row" });
  }
}

/**
 * Moves a tab to a window of its own or into another's strip, the way a drag let
 * go there would, so its page and everything else in it come through the same.
 */
export async function moveTabOut(id: TabId, to: TabMoveDestination) {
  const moving = tabStanding(id);
  const isOnlyTab = getDefaultStore().get(appTabsAtom).tabs.length === 1;
  // A window's only tab is in a window of its own already.
  if (!moving || (isOnlyTab && to.kind === "new")) {
    return;
  }
  const end = await rpcClient.window.moveTab
    .call({ isOnlyTab, moving, to })
    .catch(() => ({ kind: "none" as const }));
  settleTabMove(id, end);
}
