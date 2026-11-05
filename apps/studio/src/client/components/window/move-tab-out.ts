import { type WindowTab } from "@/client/atoms/window";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type TabId } from "@/shared/tabs";
import { getDefaultStore } from "jotai";

import { appTabsAtom } from "./app-tabs";
import {
  keepOnlyTab,
  letTabGo,
  type TabMoveDestination,
  tabStanding,
} from "./move-tab";
import { showTabCarryView } from "./tab-carry-view";

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
export async function moveTabOut(
  id: TabId,
  to: TabMoveDestination,
  allTabs: readonly WindowTab[],
) {
  const moving = tabStanding(id, allTabs);
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
