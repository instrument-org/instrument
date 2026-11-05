import { composeAtom, type WindowTab } from "@/client/atoms/window";
import { freshTabId } from "@/client/lib/tab-actions";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { captureTabView, tabViewRoot } from "@/client/lib/tab-view-state";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { insertTab, removeTab } from "@/client/lib/tabs-model";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { type Tab, type TabId } from "@/shared/tabs";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

import { appTabsAtom, groupOfHref, INBOX_HREF, isSiteGroup } from "./app-tabs";

/** The groups whose tabs went to another window, whose pages are that window's to keep or let go, until a tab comes back. */
const groupsMovedAway = new Set<string>();

export function hasMovedAway(group: string) {
  return groupsMovedAway.has(group);
}

export function forgetMovedAway(group: string) {
  groupsMovedAway.delete(group);
}

/** Where a tab can go: a new window, at a point on the screen or beside this one, or one open already. */
export type TabMoveDestination = RPCInput["window"]["moveTab"]["to"];

/**
 * A tab as another window would take it: its history, the pages that would go
 * with it, and those of the tab that comes up in its place if the rest are left
 * behind in a window of their own.
 */
export interface TabStanding {
  neighborPages: RPCInput["window"]["moveTab"]["pages"];
  pages: RPCInput["window"]["moveTab"]["pages"];
  tab: Tab;
}

/** What handing a tab to another window would hand over, as it stands now. */
export function tabStanding(
  id: TabId,
  allTabs: readonly WindowTab[],
): TabStanding | undefined {
  const { tabs } = getDefaultStore().get(appTabsAtom);
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
  const at = tabs.findIndex((each) => each.id === id);
  const neighbor = tabs[at + 1] ?? tabs[at - 1];
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
 * Hands a tab to another window with its history. The tab leaves this strip
 * only once the other window has it, and a window left with nothing closes,
 * with nothing of it to come back to. The pages the tab shows go with it,
 * unless another tab here still shows them.
 */
export async function moveTabOut(
  id: TabId,
  to: TabMoveDestination,
  allTabs: readonly WindowTab[],
) {
  const store = getDefaultStore();
  const standing = tabStanding(id, allTabs);
  if (!standing) {
    return;
  }
  const { pages, tab: moved } = standing;
  const group = groupOfHref(moved.pathname);
  if (group !== undefined && isSiteGroup(group)) {
    groupsMovedAway.add(group);
  }
  const { moved: landed } = await rpcClient.window.moveTab.call({
    pages,
    tab: moved,
    to,
  });
  if (!landed) {
    if (group !== undefined) {
      groupsMovedAway.delete(group);
    }
    return;
  }
  const isLast = store.get(appTabsAtom).tabs.length === 1;
  store.set(appTabsAtom, (current) =>
    removeTab(current, {
      id,
      newTab: { id: freshTabId(), pathname: INBOX_HREF },
    }),
  );
  if (isLast) {
    void rpcClient.window.closeEmptied.call();
  }
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
  const group = groupOfHref(tab.pathname);
  if (group !== undefined && isSiteGroup(group)) {
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
    const tabs = current.tabs.filter((tab) => tab.id === key);
    return { recentlyClosed: [], selectedId: tabs[0]?.id ?? null, tabs };
  });
  store.set(composeAtom, []);
}

/** An address in a window of its own, beside this one. */
export function openInNewWindow(href: string) {
  void rpcClient.window.moveTab.call({
    pages: [],
    tab: { id: freshTabId(), pathname: href },
    to: { kind: "new" },
  });
}

/**
 * Where a tab held at a point stands among the tabs other than itself, which are
 * taken where they would stand without it, as the strip lays them out. Layout and
 * not what is drawn, since a tab making way is on its way there, and the answer
 * would move it again.
 */
export function stripIndexAt(
  clientX: number,
  tabs: readonly { id: TabId }[],
  except: TabId,
) {
  const list = document.querySelector<HTMLElement>(
    "[data-app-tab-strip] [role=tablist]",
  );
  if (!list) {
    return 0;
  }
  const { left: listLeft, width: listWidth } = list.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = listWidth / list.offsetWidth;
  const drawn = [...list.querySelectorAll<HTMLElement>("[data-tab-key]")].map(
    (element) => ({
      key: element.dataset.tabKey,
      left: element.offsetLeft - list.offsetLeft,
      width: element.offsetWidth,
    }),
  );
  const heldAt = drawn.findIndex(({ key }) => key === except);
  const held = drawn[heldAt];
  const slot = held
    ? (drawn[heldAt + 1]?.left ?? held.left + held.width) - held.left
    : 0;
  const before = drawn.filter(({ key, left, width }, index) => {
    const standsAt = held && index > heldAt ? left - slot : left;
    return key !== except && clientX > listLeft + (standsAt + width / 2) * zoom;
  });
  const others = tabs.filter((tab) => tab.id !== except);
  const at = others.findIndex((tab) => tab.id === before.at(-1)?.key);
  return at === -1 ? 0 : at + 1;
}

/** A tab from another window comes up here, at the place along the strip it was held at. */
export function receiveTab(tab: Tab, index?: number) {
  getDefaultStore().set(appTabsAtom, (current) =>
    insertTab(current, { ...(index === undefined ? {} : { index }), tab }),
  );
}

/** Every tab of this window to another, in order, which closes it. */
export async function sendEveryTab(to: string, allTabs: readonly WindowTab[]) {
  const { tabs } = getDefaultStore().get(appTabsAtom);
  for (const tab of tabs) {
    await moveTabOut(tab.id, { id: to, kind: "window" }, allTabs);
  }
}
