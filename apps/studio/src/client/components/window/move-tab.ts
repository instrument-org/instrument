import { type WindowTab } from "@/client/atoms/window";
import { freshTabId } from "@/client/lib/tab-actions";
import { getRouterHistory } from "@/client/lib/tab-router-history";
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
  const before = store.get(appTabsAtom);
  const tab = before.tabs.find((each) => each.id === id);
  if (!tab) {
    return;
  }
  const router = getTabRouter(id);
  const moved: Tab = {
    ...tab,
    history: router ? getRouterHistory(router) : tab.history,
    pathname: router?.state.location.href ?? tab.pathname,
  };
  const group = groupOfHref(moved.pathname);
  const stillHere = before.tabs.some(
    (each) => each.id !== id && groupOfHref(each.pathname) === group,
  );
  const pages =
    group === undefined || stillHere
      ? []
      : allTabs.flatMap((each) =>
          each.group === group && each.kind === "page"
            ? [browserTargetOf(each.id)]
            : [],
        );
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

/** An address in a window of its own, beside this one. */
export function openInNewWindow(href: string) {
  void rpcClient.window.moveTab.call({
    pages: [],
    tab: { id: freshTabId(), pathname: href },
    to: { kind: "new" },
  });
}

/** Where a tab let go at a point on this window lands along the strip. */
export function stripIndexAt(clientX: number, tabs: readonly { id: TabId }[]) {
  const before = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-app-tab-strip] [data-tab-key]",
    ),
  ].filter((element) => {
    const { left, width } = element.getBoundingClientRect();
    return clientX > left + width / 2;
  });
  const last = before.at(-1)?.dataset.tabKey;
  const at = tabs.findIndex((tab) => tab.id === last);
  return at === -1 ? 0 : at + 1;
}

/** A tab from another window comes up here, at the point it was let go. */
export function receiveTab(tab: Tab, clientX?: number) {
  const store = getDefaultStore();
  store.set(appTabsAtom, (current) =>
    insertTab(current, {
      ...(clientX === undefined
        ? {}
        : { index: stripIndexAt(clientX, current.tabs) }),
      tab,
    }),
  );
}

/** Every tab of this window to another, in order, which closes it. */
export async function sendEveryTab(to: string, allTabs: readonly WindowTab[]) {
  const { tabs } = getDefaultStore().get(appTabsAtom);
  for (const tab of tabs) {
    await moveTabOut(tab.id, { id: to, kind: "window" }, allTabs);
  }
}
