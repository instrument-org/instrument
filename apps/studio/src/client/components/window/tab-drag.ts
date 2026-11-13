import { type WindowTab } from "@/client/atoms/window";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { draftsAtom } from "@/client/drafts/store";
import { draftGroupOf, draftOfGroup } from "@/shared/drafts";
import {
  type GroupTabLanding,
  type IncomingTab,
  neighborAt,
  type TabCarryView,
  TabIdSchema,
  type TabStanding,
} from "@/shared/tabs";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { atom, useAtomValue, useStore } from "jotai";
import { useLayoutEffect } from "react";

import { settleTabMove } from "./move-tab";
import { stripKeyOf } from "./pane-tabs";
import {
  showTabCarryView,
  stripIndexAt,
  tabCarryViewAtom,
  useTabCarryView,
} from "./tab-carry-view";
import { tabsIn, type WindowTabs } from "./tab-model";
import { type TabGroup, useOpenGroups, useTabGroupActions } from "./tab-groups";
import { useTabCarry } from "./use-tab-carry";
import {
  groupOnScreenAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

type TabCarryEnd = RPCOutput["window"]["endTabCarry"];

/** What a tab group's strip of tabs is found under. */
const GROUP_TABS = "[data-group-tabs]";

/**
 * Where a tab group's tab held over this window from another lands here, as
 * last measured: none while none is held, or over anywhere that takes none.
 */
export const groupTabLandingAtom = atom<GroupTabLanding | undefined>(undefined);

function contains(element: Element, x: number, y: number) {
  const { bottom, left, right, top } = element.getBoundingClientRect();
  return x >= left && x < right && y >= top && y < bottom;
}

/**
 * The row or the list at a point in the sidebar, by where they are laid out:
 * a window holding a tab keeps the pointer from everything in it.
 */
function sidebarTargetAt(x: number, y: number) {
  const list = [
    ...document.querySelectorAll<HTMLElement>("[data-group-list]"),
  ].find((each) => contains(each, x, y));
  if (!list) {
    return undefined;
  }
  const row = [...list.querySelectorAll<HTMLElement>("[data-group-row]")].find(
    (each) => contains(each, x, y),
  );
  return row
    ? { element: row, group: row.dataset.groupRow }
    : { element: list, group: undefined };
}

/** What the drag last lit, to put out again. */
let lit: HTMLElement | undefined;

function light(element: HTMLElement | undefined) {
  if (lit === element) {
    return;
  }
  lit?.removeAttribute("data-drop-target");
  lit = element;
  lit?.setAttribute("data-drop-target", "");
}

/** A group's tab as another window would take it: by its strip key, with its page. */
function groupTabStanding(
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
 * Whether a tab is all its group has, in a group whose chat has not started:
 * such a tab takes its group along to a window of its own, its draft's words
 * included.
 */
function isWholeGroup(state: WindowTabs, tab: WindowTab) {
  return (
    tab.group !== undefined &&
    draftOfGroup(tab.group) !== undefined &&
    tabsIn(state, tab.group).every((each) => each.id === tab.id)
  );
}

/**
 * Once main has said a tab went to another window, a group it took along
 * comes off this window's list.
 */
function useLetGoOfWholeGroup() {
  const store = useStore();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  return (key: string, end: TabCarryEnd, from: string | undefined) => {
    if (end.kind !== "losesTab" && end.kind !== "closes") {
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
 * window's only tab: the window's one group is a chat not started yet, and
 * this is its one tab. Such a window goes with the tab, and closes once the
 * tab lands in another.
 */
function holdsOnly(
  group: string,
  tabs: readonly WindowTab[],
  open: readonly TabGroup[],
) {
  return (
    draftOfGroup(group) !== undefined &&
    tabs.length === 1 &&
    open.every((entry) => entry.group === group)
  );
}

/**
 * A group's tab dragged the way the window's own tabs are (`useTabCarry`):
 * pulled off its row, its strip closes up and a picture of the window goes
 * with the pointer, let go in the open it is a group of its own in a window of
 * its own, and held over another window it lands where that window says. A
 * window's only tab moves its window. Over this window's sidebar it moves
 * into the group under it, or into a new group over the list's empty space,
 * and the window follows it there.
 */
export function useGroupTabCarry({
  group,
  tabs,
}: {
  group: string;
  tabs: readonly WindowTab[];
}) {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  const letGoOfWholeGroup = useLetGoOfWholeGroup();
  const order = tabs.map(stripKeyOf);
  const reorder = (keys: string[]) => {
    windowTabs.reorder(keys, group);
  };
  const idOf = (key: string) =>
    store.get(windowTabsAtom).tabs.find((each) => stripKeyOf(each) === key)?.id;
  return useTabCarry({
    isOnlyTab: holdsOnly(group, tabs, open),
    onCancel: (keys) => {
      light(undefined);
      reorder(keys);
    },
    onPlace: (key, left) => {
      const others = order.filter((each) => each !== key);
      const at = stripIndexAt(
        left,
        others.map((id) => ({ id })),
        key,
        GROUP_TABS,
      );
      if (order[at] !== key) {
        reorder(others.toSpliced(at, 0, key));
      }
    },
    onSelect: (key) => {
      const id = idOf(key);
      if (id !== undefined) {
        windowTabs.select(id);
      }
    },
    order,
    strip: {
      band: () => {
        const row = document.querySelector(GROUP_TABS)?.getBoundingClientRect();
        return { bottom: row?.bottom ?? 0, top: row?.top ?? 0 };
      },
      isOverOwnTarget: (event) => {
        const target = sidebarTargetAt(event.clientX, event.clientY);
        const takes = target !== undefined && target.group !== group;
        light(takes ? target.element : undefined);
        return takes;
      },
      onEnd: (key, end, event) => {
        light(undefined);
        if (end.kind !== "none") {
          letGoOfWholeGroup(key, end, group);
          return;
        }
        const target = sidebarTargetAt(event.clientX, event.clientY);
        const id = idOf(key);
        if (!target || target.group === group || id === undefined) {
          return;
        }
        // The window follows the tab, which stays the one up, as a browser's
        // tab dragged into another window does.
        if (target.group === undefined) {
          groups.make({ moving: id });
        } else {
          groups.moveTab(id, target.group);
          groups.show(target.group);
        }
      },
      root: GROUP_TABS,
      standing: (key) => groupTabStanding(store.get(windowTabsAtom), key),
    },
  });
}

/** Where a group's tab held over this window lands here, and what the window lights for it. */
function landingAt(
  { clientX, clientY, pointInTab, tab: held }: IncomingTab,
  state: WindowTabs,
  groupUp: string | undefined,
): undefined | { element?: HTMLElement; landing: GroupTabLanding } {
  const moving = state.tabs.find((each) => stripKeyOf(each) === held.id);
  if (!moving) {
    return undefined;
  }
  const strip = document.querySelector(GROUP_TABS);
  if (strip && contains(strip, clientX, clientY)) {
    if (groupUp === undefined || groupUp === moving.group) {
      return undefined;
    }
    const others = tabsIn(state, groupUp).flatMap((each) =>
      stripKeyOf(each) === held.id ? [] : [{ id: stripKeyOf(each) }],
    );
    return {
      landing: {
        index: stripIndexAt(clientX - pointInTab, others, held.id, GROUP_TABS),
        kind: "tabs",
      },
    };
  }
  const target = sidebarTargetAt(clientX, clientY);
  if (!target || target.group === moving.group) {
    return undefined;
  }
  return {
    element: target.element,
    landing:
      target.group === undefined
        ? { kind: "new" }
        : { group: target.group, kind: "group" },
  };
}

function isSameLanding(
  a: GroupTabLanding | undefined,
  b: GroupTabLanding | undefined,
) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Follows what main says of a tab held over this window, and tells it where a
 * group's tab held here lands: among the tabs of the group up, by where the
 * pointer is along its strip, which draws it there; on a group of the
 * sidebar, or the list's empty space for a group of its own, which lights.
 * Measured from the window as drawn, so the tab comes to rest where the
 * pointer is once it has joined the strip.
 */
export function useGroupTabLanding() {
  useTabCarryView();
  const store = useStore();
  const view = useAtomValue(tabCarryViewAtom);
  const landing = useAtomValue(groupTabLandingAtom);
  useLayoutEffect(() => {
    const found =
      view.kind === "incoming"
        ? landingAt(
            view,
            store.get(windowTabsAtom),
            store.get(groupOnScreenAtom),
          )
        : undefined;
    light(found?.element);
    const next = found?.landing;
    if (isSameLanding(next, store.get(groupTabLandingAtom))) {
      return;
    }
    store.set(groupTabLandingAtom, next);
    if (view.kind === "incoming") {
      void rpcClient.window.placeGroupTabCarry
        .call({ landing: next ?? null })
        .catch(() => undefined);
    }
  }, [landing, store, view]);
}

/**
 * The tab held over this window's group strip, where it lands among the
 * group's tabs and where it is drawn: its left edge at the pointer.
 */
export function incomingGroupTab(
  view: TabCarryView,
  landing: GroupTabLanding | undefined,
  allTabs: readonly WindowTab[],
) {
  if (view.kind !== "incoming" || landing?.kind !== "tabs") {
    return undefined;
  }
  const tab = allTabs.find((each) => stripKeyOf(each) === view.tab.id);
  return tab
    ? {
        heldAt: { key: view.tab.id, left: view.clientX - view.pointInTab },
        index: landing.index ?? Number.POSITIVE_INFINITY,
        tab,
      }
    : undefined;
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
  return {
    receive: (key: string, landing: GroupTabLanding) => {
      store.set(groupTabLandingAtom, undefined);
      light(undefined);
      if (store.get(tabCarryViewAtom).kind === "incoming") {
        showTabCarryView({ kind: "row" });
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
      // A window come up for the tab, on a new tab of its own making.
      const own =
        landing.kind === "new" && landing.isWindowOfItsOwn === true
          ? groupUp
          : undefined;
      if (
        landing.kind === "new" &&
        from !== undefined &&
        isWholeGroup(state, tab)
      ) {
        // Its group comes along whole, and the window it leaves lets go of it.
        groups.showHere(from);
        const draft = store
          .get(draftsAtom)
          .find((entry) => draftGroupOf(entry.id) === from);
        if (own !== undefined && own !== from && draft) {
          groups.close(own, [{ draft, group: from, kind: "draft", title: "" }]);
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
      } else if (landing.kind === "new" || groupUp === undefined) {
        groups.make({ moving: tab.id });
      } else {
        groups.moveTab(tab.id, groupUp);
        const keys = tabsIn(store.get(windowTabsAtom), groupUp)
          .map(stripKeyOf)
          .filter((each) => each !== key);
        windowTabs.reorder(
          keys.toSpliced(landing.index ?? keys.length, 0, key),
          groupUp,
        );
      }
      if (neighbor) {
        windowTabs.select(neighbor.id);
      }
    },
    toNewWindow: (id: string) => {
      const state = store.get(windowTabsAtom);
      const tab = state.tabs.find((each) => each.id === id);
      const { group } = tab ?? {};
      if (!tab || group === undefined) {
        return;
      }
      const key = stripKeyOf(tab);
      const moving = groupTabStanding(state, key);
      // A window's only tab is in a window of its own already.
      if (!moving || holdsOnly(group, tabsIn(state, group), open)) {
        return;
      }
      void rpcClient.window.moveTab
        .call({ isOnlyTab: false, moving, to: { kind: "new" } })
        .catch(() => ({ kind: "none" as const }))
        .then((end) => {
          settleTabMove(key, end);
          letGoOfWholeGroup(key, end, group);
        });
    },
  };
}
