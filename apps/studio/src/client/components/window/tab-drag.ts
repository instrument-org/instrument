import { type WindowTab } from "@/client/atoms/window";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type GroupTabLanding,
  groupOfWholeKey,
  neighborAt,
  TabIdSchema,
  type TabMoveDestination,
  type TabStanding,
  wholeGroupKey,
} from "@/shared/tabs";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { useStore } from "jotai";

import { endFromElsewhere } from "./drag/session";
import { settleTabMove } from "./move-tab";
import { stripKeyOf } from "./pane-tabs";
import { fillRoom } from "./sidebar-drop";
import { showTabCarryView, tabCarryViewAtom } from "./tab-carry-view";
import { tabsIn, type WindowTabs } from "./tab-model";
import { type TabGroup, useOpenGroups, useTabGroupActions } from "./tab-groups";
import { windowTabGroupsAtom } from "./open-groups";
import { groupHref } from "./window-href";
import {
  groupOnScreenAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

type TabCarryEnd = RPCOutput["window"]["endTabCarry"];

/** A whole group as another window would take it: under its own key, with the page of every tab it has. */
export function wholeGroupStanding(
  state: WindowTabs,
  group: string,
): TabStanding {
  return {
    hostedPages: [],
    isGroupTab: true,
    neighborPages: [],
    pages: tabsIn(state, group).flatMap((tab) =>
      tab.kind === "page" ? [browserTargetOf(tab.id)] : [],
    ),
    tab: {
      id: TabIdSchema.parse(wholeGroupKey(group)),
      pathname: groupHref(group),
    },
  };
}

/** A group's tab as another window would take it: by its strip key, with its page. */
export function groupTabStanding(
  state: WindowTabs,
  key: string,
): TabStanding | undefined {
  const tab = state.tabs.find((each) => stripKeyOf(each) === key);
  if (!tab) {
    return undefined;
  }
  return {
    hostedPages: [],
    isGroupTab: true,
    neighborPages: [],
    pages: tab.kind === "page" ? [browserTargetOf(tab.id)] : [],
    tab: {
      id: TabIdSchema.parse(key),
      pathname:
        tab.kind === "page" ? (tab.url ?? tab.openedUrl ?? "") : tab.href,
    },
  };
}

/**
 * Whether a tab is all its group has: such a tab takes its group along to a
 * window of its own, its name and pin included.
 */
function isWholeGroup(state: WindowTabs, tab: WindowTab) {
  return (
    tab.group !== undefined &&
    tabsIn(state, tab.group).every((each) => each.id === tab.id)
  );
}

/**
 * Once main has said a tab went to another window, a group it took along
 * comes off this window's list. A window that closes for it goes on showing
 * what it shows until it has gone.
 */
export function useLetGoOfWholeGroup() {
  const store = useStore();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  return (key: string, end: TabCarryEnd, from: string | undefined) => {
    if (end.kind !== "losesTab") {
      return;
    }
    const state = store.get(windowTabsAtom);
    const tab = state.tabs.find((each) => stripKeyOf(each) === key);
    if (
      tab &&
      from !== undefined &&
      tab.group === from &&
      isWholeGroup(state, tab)
    ) {
      groups.letGo(from, open);
    }
  };
}

/**
 * Whether a group's tab is all its window holds, which main reads as a
 * window's only tab: the window's one group has this one tab. Such a window
 * goes with the tab, and closes once the tab lands in another.
 */
export function holdsOnly(
  group: string,
  tabs: readonly WindowTab[],
  open: readonly TabGroup[],
) {
  return tabs.length === 1 && open.every((entry) => entry.group === group);
}

/**
 * What a window does with a group's tab from elsewhere: takes one let go over
 * it into its groups, where it landed, and sends the tab up to a window of its
 * own (Tab > Move Tab to New Window) as a drag let go in the open would.
 */
export function useGroupTabMoves() {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  const letGoOfWholeGroup = useLetGoOfWholeGroup();
  /** The tab out to a window of its own or another open one, by main's carry (`moveTab`). */
  const moveOut = (id: string, to: TabMoveDestination) => {
    const state = store.get(windowTabsAtom);
    const tab = state.tabs.find((each) => each.id === id);
    const { group } = tab ?? {};
    if (!tab || group === undefined) {
      return;
    }
    const key = stripKeyOf(tab);
    const moving = groupTabStanding(state, key);
    const isOnlyTab = holdsOnly(group, tabsIn(state, group), open);
    // A window's only tab is in a window of its own already.
    if (!moving || (isOnlyTab && to.kind === "new")) {
      return;
    }
    void rpcClient.window.moveTab
      .call({ isOnlyTab, moving, to })
      .catch(() => ({ kind: "none" as const }))
      .then((end) => {
        settleTabMove(key, end);
        letGoOfWholeGroup(key, end, group);
      });
  };
  /**
   * A window come up for what landed lists it alone: the new group it came
   * up on leaves its list, along with any other it had.
   */
  const listAlone = (group: string) => {
    const others = (store.get(windowTabGroupsAtom) ?? []).filter(
      (each) => each !== group,
    );
    if (others.length > 0) {
      groups.closeAll(others, group);
    }
  };
  /** A whole group from another window: listed where it was let go, or at the top, and up. */
  const receiveWhole = (group: string, landing: GroupTabLanding) => {
    groups.place(group, landing.kind === "new" && landing.at ? landing.at : {});
    fillRoom(group);
    groups.show(group);
    if (landing.kind === "new" && landing.isWindowOfItsOwn === true) {
      listAlone(group);
    }
  };
  return {
    receive: (key: string, landing: GroupTabLanding) => {
      endFromElsewhere("remote");
      if (store.get(tabCarryViewAtom).kind === "incoming") {
        showTabCarryView({ kind: "row" });
      }
      const whole = groupOfWholeKey(key);
      if (whole !== undefined) {
        receiveWhole(whole, landing);
        return;
      }
      const state = store.get(windowTabsAtom);
      const tab = state.tabs.find((each) => stripKeyOf(each) === key);
      if (!tab) {
        return;
      }
      // The group it leaves has the tab beside it up, as a strip does when
      // its tab up goes.
      const from = tab.group;
      const left = tabsIn(state, from);
      const neighbor =
        from !== undefined && state.activeByGroup[from] === tab.id
          ? neighborAt(left, left.indexOf(tab))
          : undefined;
      const groupUp = store.get(groupOnScreenAtom);
      const isOwnWindow =
        landing.kind === "new" && landing.isWindowOfItsOwn === true;
      // A window come up for the tab, on a new tab of its own making, which
      // may not be up yet in a window out of sight.
      const own = isOwnWindow ? groupUp : undefined;
      // Where in the sidebar a group of its own lands, which it fills.
      const at = landing.kind === "new" ? landing.at : undefined;
      if (
        landing.kind === "new" &&
        from !== undefined &&
        isWholeGroup(state, tab)
      ) {
        // Its group comes along whole, and the window it leaves lets go of it.
        if (at) {
          groups.place(from, at);
          fillRoom(from);
        }
        groups.showHere(from);
        if (isOwnWindow) {
          listAlone(from);
        }
      } else if (landing.kind === "group") {
        groups.moveTab(tab.id, landing.group);
        groups.show(landing.group);
      } else if (own !== undefined) {
        // The tab takes the place of the new tab the window came up on.
        const blanks = tabsIn(state, own);
        groups.moveTab(tab.id, own);
        for (const blank of blanks) {
          windowTabs.close(blank.id);
        }
        listAlone(own);
      } else if (landing.kind === "new" || groupUp === undefined) {
        const made = groups.make({
          moving: tab.id,
          ...(at ? { place: at } : {}),
        });
        if (at) {
          fillRoom(made);
        }
        if (isOwnWindow) {
          listAlone(made);
        }
      } else {
        // Among a side's tabs, or on a side's page, of the group up.
        groups.moveTab(tab.id, groupUp);
        windowTabs.moveTo({
          group: groupUp,
          id: tab.id,
          select: true,
          ...(landing.kind === "side"
            ? { side: landing.side, split: landing.split }
            : {
                side: landing.side ?? 0,
                ...(landing.index === undefined
                  ? {}
                  : { index: landing.index }),
              }),
        });
      }
      if (neighbor) {
        windowTabs.select(neighbor.id);
      }
    },
    toNewWindow: (id: string) => {
      moveOut(id, { kind: "new" });
    },
    /** The tab to another window that is open, as a drag let go over it would; a window's only tab takes its window's place there. */
    toWindow: (id: string, windowId: string) => {
      moveOut(id, { id: windowId, kind: "window" });
    },
  };
}

