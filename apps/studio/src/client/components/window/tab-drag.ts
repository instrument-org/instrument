import { type WindowTab } from "@/client/atoms/window";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { draftOfGroup } from "@/shared/drafts";
import {
  type GroupTabLanding,
  groupOfWholeKey,
  type IncomingTab,
  neighborAt,
  type TabCarryView,
  TabIdSchema,
  type TabStanding,
  wholeGroupKey,
} from "@/shared/tabs";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { atom, getDefaultStore, useAtomValue, useStore } from "jotai";
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
} from "react";

import { settleTabMove } from "./move-tab";
import { stripKeyOf } from "./pane-tabs";
import {
  showTabCarryView,
  stripIndexAt,
  tabCarryViewAtom,
  useTabCarryView,
} from "./tab-carry-view";
import {
  type DropCarry,
  filledRoomAtom,
  heldOverSidebarAtom,
  LIST_GAP_PX,
  liftedRowAtom,
  roomSnapsAtom,
  ROW_GAP_PX,
  type SidebarDrop,
  sidebarDropAt,
  sidebarDropAtom,
} from "./sidebar-drop";
import { tabsIn, type WindowTabs } from "./tab-model";
import {
  groupHref,
  type TabGroup,
  useOpenGroups,
  useTabGroupActions,
  windowTabGroupsAtom,
} from "./tab-groups";
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
 * Shows where a drag over this window's sidebar lands, or that it lands
 * nowhere there, the room sliding to it, and what is held over the sidebar,
 * which it draws at the pointer as a row.
 */
function showDrop(
  drop: SidebarDrop | undefined,
  held?: { clientX: number; clientY: number; key: string },
) {
  const store = getDefaultStore();
  if (JSON.stringify(store.get(sidebarDropAtom)) !== JSON.stringify(drop)) {
    store.set(roomSnapsAtom, false);
    store.set(sidebarDropAtom, drop);
  }
  if (JSON.stringify(store.get(heldOverSidebarAtom)) !== JSON.stringify(held)) {
    store.set(heldOverSidebarAtom, held);
  }
}

/** How long a group that filled a room goes on not arriving. */
const FILLED_MS = 500;

/**
 * Shuts the sidebar's room at once, for what was let go in it, which
 * stands where the room was: a lifted row back in the list, or a group new
 * to it, which takes its place without arriving.
 */
function fillRoom(group: string | undefined) {
  const store = getDefaultStore();
  store.set(roomSnapsAtom, true);
  store.set(sidebarDropAtom, undefined);
  store.set(heldOverSidebarAtom, undefined);
  store.set(liftedRowAtom, undefined);
  if (group === undefined) {
    return;
  }
  store.set(filledRoomAtom, group);
  setTimeout(() => {
    if (store.get(filledRoomAtom) === group) {
      store.set(filledRoomAtom, undefined);
    }
  }, FILLED_MS);
}

/** A whole group as another window would take it: under its own key, with the page of every tab it has. */
function wholeGroupStanding(state: WindowTabs, group: string): TabStanding {
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
 * comes off this window's list. A window that closes for it goes on showing
 * what it shows until it has gone.
 */
function useLetGoOfWholeGroup() {
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
 * window's only tab moves its window. Over this window's sidebar it goes as a
 * row at the pointer in place of the picture, and moves into the group under
 * it, or into a new group at the top over New or the list's empty space, and
 * the window follows it there.
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
      showDrop(undefined);
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
      // Anywhere over the sidebar the tab stays in this window, drawn there
      // as a row; where it lands there, if anywhere, the list shows.
      isOverOwnTarget: (event, key) => {
        const { clientX, clientY } = event;
        const { drop, isOver } = sidebarDropAt(clientX, clientY, {
          carries: "tab",
          from: group,
        });
        showDrop(drop, isOver ? { clientX, clientY, key } : undefined);
        return isOver;
      },
      onEnd: (key, end) => {
        const drop = store.get(sidebarDropAtom);
        showDrop(undefined);
        if (end.kind !== "none") {
          letGoOfWholeGroup(key, end, group);
          return;
        }
        const id = idOf(key);
        if (!drop || id === undefined) {
          return;
        }
        // The window follows the tab, which stays the one up, as a browser's
        // tab dragged into another window does.
        if (drop.kind === "new") {
          groups.make({ moving: id });
        } else if (drop.kind === "into") {
          groups.moveTab(id, drop.group);
          groups.show(drop.group);
        }
      },
      root: GROUP_TABS,
      standing: (key) => groupTabStanding(store.get(windowTabsAtom), key),
    },
  });
}

/**
 * Where a group's tab, or a whole group, held over this window lands here,
 * and what the sidebar shows for it. A whole group lands between rows alone.
 */
function landingAt(
  { clientX, clientY, pointInTab, tab: held }: IncomingTab,
  state: WindowTabs,
  groupUp: string | undefined,
): undefined | { drop?: SidebarDrop; landing: GroupTabLanding } {
  const whole = groupOfWholeKey(held.id);
  if (whole !== undefined) {
    const { drop } = sidebarDropAt(clientX, clientY, {
      carries: "group",
      gap: ROW_GAP_PX,
    });
    return drop?.kind === "between"
      ? { drop, landing: { at: drop.place, kind: "new" } }
      : undefined;
  }
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
  const { drop } = sidebarDropAt(clientX, clientY, {
    carries: "tab",
    from: moving.group,
  });
  if (drop?.kind === "into") {
    return { drop, landing: { group: drop.group, kind: "group" } };
  }
  return drop?.kind === "new" ? { drop, landing: { kind: "new" } } : undefined;
}

function isSameLanding(
  a: GroupTabLanding | undefined,
  b: GroupTabLanding | undefined,
) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Follows what main says of a tab held over this window, and tells it where a
 * group's tab, or a whole group, held here lands: among the tabs of the group
 * up, by where the pointer is along its strip, which draws it there; in a
 * group of the sidebar, whose row takes its selected tone, or as a group of
 * its own at the top, over New or the list's empty space; or, for a whole
 * group, between two rows, where the list opens a room. Wherever it lands in
 * the sidebar, the sidebar draws it at the pointer as a row. Measured from
 * the window as drawn, so the tab comes to rest where the pointer is once it
 * has joined the strip.
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
    showDrop(
      found?.drop,
      found?.drop && view.kind === "incoming"
        ? { clientX: view.clientX, clientY: view.clientY, key: view.tab.id }
        : undefined,
    );
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
      store.set(groupTabLandingAtom, undefined);
      showDrop(undefined);
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
      if (
        landing.kind === "new" &&
        from !== undefined &&
        isWholeGroup(state, tab)
      ) {
        // Its group comes along whole, and the window it leaves lets go of it.
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
        const made = groups.make({ moving: tab.id });
        if (isOwnWindow) {
          listAlone(made);
        }
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

/** How far a pressed row moves before it lifts out of the list. */
const ROW_LIFT_PX = 4;
/** How far past the sidebar's edge a lifted row goes before it leaves the window's list. */
const ROW_OFF_PX = 24;
/** How far past the window's edge, anywhere, the same. */
const WINDOW_OFF_PX = 16;

/**
 * Whether a lifted row at a point has left the sidebar: past the window's
 * edge, or well past the sidebar's, and back over the sidebar to return.
 */
function isOffSidebar(x: number, y: number, wasOff: boolean) {
  const nav = document
    .querySelector('nav[aria-label="Tab groups"]')
    ?.getBoundingClientRect();
  if (
    !nav ||
    x < -WINDOW_OFF_PX ||
    y < -WINDOW_OFF_PX ||
    x > window.innerWidth + WINDOW_OFF_PX ||
    y > window.innerHeight + WINDOW_OFF_PX
  ) {
    return true;
  }
  return x > nav.right + (wasOff ? 0 : ROW_OFF_PX);
}

/** Keeps the click a drag's release makes from choosing the row under it. */
function swallowNextClick() {
  const swallow = (click: MouseEvent) => {
    click.stopPropagation();
    click.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => {
    window.removeEventListener("click", swallow, { capture: true });
  }, 0);
}

/** One press on a row of the sidebar, from the press to its release. */
interface RowPress {
  carry: DropCarry;
  group: string;
  /** Where in the row the press was, in the window's px. */
  grab: { x: number; y: number };
  /** Main carries it now, off the sidebar or back over it. */
  isCarried: boolean;
  isCanceled: boolean;
  isLifted: boolean;
  isOff: boolean;
  start: { x: number; y: number };
  stop: () => void;
  /** The group the window showed at the press, which it shows again. */
  upAtPress: string | undefined;
}

/**
 * A row of the sidebar dragged: pressed and moved, it lifts out of the list
 * and goes with the pointer, the list opening a room where it would land
 * (`sidebarDropAt`), among the pinned rows to pin it or the rest to unpin it.
 * Pulled off the sidebar, main carries the whole group the way a group's tab
 * is carried (`useTabCarry`): a picture of the window goes with the pointer,
 * let go in the open the group is a window of its own, and held over another
 * window's sidebar it lands where that window opens a room. A window's only
 * group is main's window with one tab: the window goes with the pointer, and
 * closes once the group lands in another. Back over the sidebar it is a
 * lifted row again, and Escape puts it back.
 */
export function useGroupRowDrag() {
  const store = useStore();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  const listed = useAtomValue(windowTabGroupsAtom) ?? [];
  const pressed = useRef<RowPress>(undefined);
  /** The press main's carry belongs to, which outlasts the release until main has said where it went. */
  const carried = useRef<RowPress>(undefined);

  /** The window back on what it showed at the press, or on the group the press left it on. */
  const showBack = (press: RowPress, fallback = press.group) => {
    const target = press.upAtPress === press.group ? fallback : press.upAtPress;
    if (
      target !== undefined &&
      target !== groups.groupUp() &&
      store.get(windowTabGroupsAtom)?.includes(target)
    ) {
      groups.show(target);
    }
  };

  const carry = useTabCarry({
    isOnlyTab: listed.length === 1,
    onCancel: () => {
      const press = carried.current;
      carried.current = undefined;
      fillRoom(undefined);
      if (press) {
        showBack(press);
      }
    },
    onPlace: () => undefined,
    // Off the sidebar the window shows what it did at the press, or, when
    // that was the row's own group, the one beside it, as if it had gone.
    onSelect: (key) => {
      const press = carried.current;
      if (press) {
        showBack(press, groupOfWholeKey(key));
      }
    },
    order: listed.map(wholeGroupKey),
    strip: {
      band: () => ({ bottom: window.innerHeight, top: 0 }),
      find: {
        item: (key) =>
          document.querySelector("[data-lifted-copy]") ??
          document.querySelector(
            `[data-drop-item=${JSON.stringify(`row:${groupOfWholeKey(key) ?? ""}`)}]`,
          ),
        row: () => document.querySelector("[data-group-list]"),
      },
      isOff: () => pressed.current?.isOff ?? carried.current?.isOff ?? true,
      isOverOwnTarget: () => false,
      onEnd: (key, end) => {
        const press = carried.current;
        carried.current = undefined;
        const group = groupOfWholeKey(key);
        if (group === undefined) {
          return;
        }
        // A window that closes for it goes on showing what it shows until it has gone.
        if (end.kind === "losesTab" || end.kind === "closes") {
          if (end.kind === "losesTab") {
            groups.letGo(group, open);
          }
          fillRoom(undefined);
          return;
        }
        const drop = store.get(sidebarDropAtom);
        if (drop?.kind === "between") {
          groups.place(group, drop.place);
        }
        fillRoom(group);
        if (press) {
          showBack(press);
        }
      },
      root: "[data-group-list]",
      standing: (key) => {
        const group = groupOfWholeKey(key);
        return group === undefined
          ? undefined
          : wholeGroupStanding(store.get(windowTabsAtom), group);
      },
    },
  });

  /** Where the lifted row stands and lands, with the pointer at a point. */
  const follow = (press: RowPress, move: PointerEvent) => {
    const list = document.querySelector<HTMLElement>("[data-group-list]");
    if (!list) {
      return;
    }
    press.isOff = isOffSidebar(move.clientX, move.clientY, press.isOff);
    const bounds = list.getBoundingClientRect();
    const zoom = list.offsetHeight > 0 ? bounds.height / list.offsetHeight : 1;
    const top = move.clientY - press.grab.y;
    // Measured by the row's top edge, over the list whatever the pointer's
    // way across it, so the row lands where it is seen.
    const { drop } = press.isOff
      ? { drop: undefined }
      : sidebarDropAt(
          bounds.left + bounds.width / 2,
          Math.min(Math.max(top + 1, bounds.top), bounds.bottom - 1),
          press.carry,
        );
    showDrop(drop);
    store.set(liftedRowAtom, {
      group: press.group,
      isOff: press.isOff,
      top: (top - bounds.top) / zoom + list.scrollTop,
    });
  };

  return (group: string, event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target instanceof Element && event.target.closest("button"))
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    // The room it opens is the row's own place in the list, which shuts as it lifts.
    const item =
      event.currentTarget.closest<HTMLElement>("[data-drop-item]") ?? undefined;
    const press: RowPress = {
      carry: {
        carries: "group",
        gap: item ? item.offsetHeight + LIST_GAP_PX : ROW_GAP_PX,
      },
      grab: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      group,
      isCanceled: false,
      isCarried: false,
      isLifted: false,
      isOff: false,
      start: { x: event.clientX, y: event.clientY },
      stop: () => {
        window.removeEventListener("pointermove", onMove, { capture: true });
        window.removeEventListener("pointerup", onUp, { capture: true });
        window.removeEventListener("pointercancel", onUp, { capture: true });
        window.removeEventListener("keydown", onKey, { capture: true });
        if (pressed.current === press) {
          pressed.current = undefined;
        }
      },
      upAtPress: groups.groupUp(),
    };
    const key = wholeGroupKey(group);
    const onMove = (move: PointerEvent) => {
      if (!move.isPrimary || press.isCanceled) {
        return;
      }
      if (!press.isLifted) {
        if (
          Math.hypot(
            move.clientX - press.start.x,
            move.clientY - press.start.y,
          ) < ROW_LIFT_PX
        ) {
          return;
        }
        press.isLifted = true;
        // A page runs in a process of its own, which would take the pointer
        // and the release with it.
        document.documentElement.toggleAttribute("data-tab-held", true);
        follow(press, move);
        // The room opens where the row was, which it stands in already.
        store.set(roomSnapsAtom, true);
        return;
      }
      follow(press, move);
      if (press.isOff && !press.isCarried) {
        press.isCarried = true;
        carried.current = press;
        // The picture that goes with the pointer is of the window showing it.
        if (groups.groupUp() !== group) {
          groups.show(group);
        }
        carry.onDragStart(key, move, 0);
      }
      if (press.isCarried) {
        carry.onDrag(key, move);
      }
    };
    const onUp = (up: PointerEvent) => {
      if (!up.isPrimary) {
        return;
      }
      press.stop();
      if (!press.isLifted) {
        return;
      }
      swallowNextClick();
      if (press.isCarried || press.isCanceled) {
        // Main says where a carried row went, and the carry ends it there.
        return;
      }
      document.documentElement.removeAttribute("data-tab-held");
      const drop = store.get(sidebarDropAtom);
      if (drop?.kind === "between") {
        groups.place(group, drop.place);
      }
      fillRoom(group);
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (
        keyEvent.key !== "Escape" ||
        !press.isLifted ||
        press.isCarried ||
        press.isCanceled
      ) {
        return;
      }
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      press.isCanceled = true;
      document.documentElement.removeAttribute("data-tab-held");
      fillRoom(undefined);
    };
    pressed.current?.stop();
    pressed.current = press;
    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
  };
}
