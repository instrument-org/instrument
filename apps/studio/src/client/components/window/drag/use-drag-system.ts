import { UNDO_LABEL } from "@/client/lib/undo-toast";
import { type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";
import {
  applyBookmarkOpsAtom,
  bookmarksAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import {
  endOwnFileDrag,
  ownFileDragInAir,
  releaseSelfFileDrag,
  sawOwnFileDrag,
} from "@/client/lib/self-file-drag";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  type Bookmark,
  type BookmarkOp,
  orderAfter,
  siblingsIn,
  ordersAt,
} from "@/shared/bookmarks";
import {
  type GroupTabLanding,
  groupOfWholeKey,
  type IncomingTab,
} from "@/shared/tabs";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useLayoutEffect, useRef } from "react";

import { type BrowserTabsHandle } from "../browser-tabs";
import { segmentsOf } from "../host-path";
import { settleTabMove } from "../move-tab";
import { stripKeyOf } from "../pane-tabs";
import { nextUpAfter, NO_OPENERS } from "../tab-openers";
import { useTabTitle } from "../tab-title";
import { fillRoom, ROW_GAP_PX } from "../sidebar-drop";
import {
  showTabCarryView,
  tabCarryViewAtom,
  useTabCarryView,
} from "../tab-carry-view";
import {
  groupTabStanding,
  holdsOnly,
  useLetGoOfWholeGroup,
  wholeGroupStanding,
} from "../tab-drag";
import { windowTabGroupsAtom } from "../open-groups";
import { useOpenGroups, useTabGroupActions } from "../tab-groups";
import {
  groupLayoutOf,
  sideIndexOf,
  sideOf,
  tabsIn,
  upTabsIn,
} from "../tab-model";
import {
  newScreenId,
  useWindowTabs,
  useWindowTabsChange,
  windowTabsAtom,
} from "../window-tabs";
import {
  droppedFileHref,
  filesOfDrop,
  type Opens,
  opensOf,
  tabsOfHeldGroup,
} from "./held-tabs";
import { outcomeOf } from "./letting-go";
import { carriesFiles, whenUnheard } from "./native-drag";
import { keptAs } from "./use-bookmarks-drag";
import { type Point } from "./landing";
import {
  type Carry,
  endFromElsewhere,
  followNative,
  followRemote,
  releaseNative,
  setCarrier,
  setLander,
} from "./session";
import { ownLinkInAir } from "./content-drag";
import {
  type ContentHeld,
  type DroppedFile,
  type Held,
  type Landing,
  placeOf,
} from "./types";

/**
 * The window's side of every drag (`session`): what letting go does where
 * the window's own moves land it, what main carries past the window's
 * edges, another window's tab or group held over this one, and files the
 * system's drag holds over it. Mounted once, by the window.
 */
export function useDragSystem({
  browser,
  chatTitles,
}: {
  /** The window's pages, which a bookmark of a site opens among. */
  browser: BrowserTabsHandle | null;
  chatTitles: Map<ChatId, string>;
}) {
  const land = useLander(browser, useTabTitle(chatTitles));
  const carry = useCarrier();
  const latest = useRef({ carry, land });
  useLayoutEffect(() => {
    latest.current = { carry, land };
  });
  useEffect(() => {
    setLander((held, landing) => {
      latest.current.land(held, landing);
    });
    setCarrier((held, event, grab) => latest.current.carry(held, event, grab));
    return () => {
      setLander(undefined);
      setCarrier(undefined);
    };
  }, []);
  useRemoteDrags();
  const groups = useTabGroupActions();
  const windowTabs = useWindowTabs();
  useSystemDrags();
  return {
    /** Files let go where nothing else takes them, opened as a tab group of their own, the first up. */
    openFilesAsGroup: (files: readonly DroppedFile[]) => {
      groups.make({
        fill: (group) => {
          let first: string | undefined;
          for (const file of files) {
            const id = windowTabs.openScreen(droppedFileHref(file), { group });
            if (first === undefined) {
              first = id;
            }
          }
          if (first !== undefined) {
            windowTabs.select(first);
          }
        },
      });
    },
  };
}

/**
 * Takes a place off Files' sidebar, as a place of Favorites let go where
 * nothing takes it does in Finder, with an Undo that puts it back where it
 * stood among `favorites`, the rows as they were.
 */
function removeFavorite(path: string, favorites: readonly string[]) {
  rpcClient.preferences.removeFavoritePlace.call({ path }).then(
    () => {
      toast(`Removed ${segmentsOf(path).at(-1) ?? path} from Favorites`, {
        action: {
          label: UNDO_LABEL,
          onClick: () => {
            void rpcClient.preferences.addFavoritePlace
              .call({ order: [...favorites], path })
              .catch(() => {
                toast.error("Couldn't change the sidebar");
              });
          },
        },
      });
    },
    () => {
      toast.error("Couldn't change the sidebar");
    },
  );
}

/**
 * What letting go does where the window's own moves land it, as
 * `outcomeOf` says: a tab or a whole group moves there; a link or files
 * open there as the tabs their addresses name, through the same openers as
 * every other tab (`opensOf`); anything let go on the bookmarks is kept
 * there; a place of Favorites let go where nothing takes it leaves Favorites,
 * with Undo; and a bookmark let go where nothing takes it is removed, with
 * Undo.
 */
function useLander(
  browser: BrowserTabsHandle | null,
  titleOf: (tab: WindowTab) => string,
) {
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const { open: openGroups } = useOpenGroups();
  const keep = useKeepBookmark();
  const store = useStore();

  /** Opens a tab at a place, under an id when it has one; a new tab named turns into it. */
  const openOne = (
    opens: Opens,
    placing: {
      after?: string;
      group: string;
      id?: string;
      side?: 0 | 1;
    },
    replacing?: string,
  ): string | undefined => {
    const { id, ...place } = placing;
    if (replacing !== undefined) {
      const tab = store
        .get(windowTabsAtom)
        .tabs.find((each) => each.id === replacing);
      if (opens.kind === "screen") {
        windowTabs.visitHref(replacing, opens.href);
        return replacing;
      }
      return tab
        ? browser?.open(opens.url, { ...place, replacing: tab })
        : undefined;
    }
    return opens.kind === "page"
      ? browser?.open(opens.url, place)
      : windowTabs.openScreen(opens.href, {
          ...place,
          ...(id === undefined ? {} : { id }),
        });
  };

  /** Opens what a link or files name as tabs where they landed, the first up and the rest right after it. */
  const openAt = (held: Held, landing: Landing) => {
    // Each opens under the id its stand-in was drawn under while held.
    const [first, ...rest] = opensOf(held);
    if (!first) {
      return;
    }
    const openRest = (group: string, after: string) => {
      let previous = after;
      for (const { id, opens } of rest) {
        previous = openOne(opens, { after: previous, group, id }) ?? previous;
      }
    };
    /** The first in a new group, made here or for a window of its own, the rest after it. */
    const fill = (group: string) => {
      const id = openOne(first.opens, { group, id: first.id });
      if (id !== undefined) {
        windowTabs.select(id);
        openRest(group, id);
      }
    };
    switch (landing.kind) {
      case "strip": {
        const id = openOne(first.opens, {
          group: landing.group,
          id: first.id,
          side: landing.side,
        });
        if (id === undefined) {
          return;
        }
        windowTabs.moveTo({
          group: landing.group,
          id,
          index: landing.index,
          select: true,
          side: landing.side,
        });
        openRest(landing.group, id);
        return;
      }
      case "side": {
        // An opener puts the tab up beside the tab up on the side with the
        // keyboard, wherever it then moves to, so each other side's tab up
        // is put back as it was.
        const upBefore = groupLayoutOf(
          store.get(windowTabsAtom),
          landing.group,
        ).sides.map((side) => side.up);
        const id = openOne(first.opens, { group: landing.group, id: first.id });
        if (id === undefined) {
          return;
        }
        windowTabs.moveTo({
          group: landing.group,
          id,
          select: true,
          side: landing.side,
          split: landing.split,
        });
        openRest(landing.group, id);
        const layout = groupLayoutOf(store.get(windowTabsAtom), landing.group);
        const landedOn = sideIndexOf(layout, id);
        for (const up of upBefore) {
          const side = up === undefined ? undefined : sideIndexOf(layout, up);
          if (up !== undefined && side !== undefined && side !== landedOn) {
            windowTabs.raise(up);
          }
        }
        return;
      }
      case "newTab": {
        const id = openOne(first.opens, { group: landing.group }, landing.tab);
        if (id !== undefined) {
          windowTabs.select(id);
          openRest(landing.group, id);
        }
        return;
      }
      case "replace": {
        // A step in that tab's history, so Back returns to what it showed:
        // a page goes on in its own guest, and anything else becomes the
        // page or screen in the tab's place.
        const tab = store
          .get(windowTabsAtom)
          .tabs.find((each) => each.id === landing.tab);
        if (tab?.kind === "page" && first.opens.kind === "page" && browser) {
          browser.navigateTab(tab.id, first.opens.url);
          windowTabs.select(tab.id);
          openRest(landing.group, tab.id);
          return;
        }
        const id = openOne(first.opens, { group: landing.group }, landing.tab);
        if (id !== undefined) {
          windowTabs.select(id);
          openRest(landing.group, id);
        }
        return;
      }
      case "sidebar": {
        const { drop } = landing;
        if (drop.kind === "into") {
          fill(drop.group);
          return;
        }
        fillRoom(groups.make({ fill, place: drop.place }));
        return;
      }
      case "window": {
        groups.moveToNewWindow(
          groups.make({ fill, isShownHere: false }),
          openGroups,
        );
        return;
      }
      // Where what is held lands as itself, with nothing to open.
      case "attach":
      case "bookmarks":
      case "favorite":
      case "into":
      case "unfavorite": {
        return;
      }
    }
  };

  /** A tab, or a whole group's tabs, moved where they landed. */
  const moveTo = (
    held: Extract<Held, { kind: "group" | "tab" }>,
    landing: Landing,
  ) => {
    if (held.kind === "tab") {
      switch (landing.kind) {
        case "strip": {
          windowTabs.moveTo({
            group: landing.group,
            id: held.id,
            index: landing.index,
            select: true,
            side: landing.side,
          });
          return;
        }
        case "side": {
          windowTabs.moveTo({
            group: landing.group,
            id: held.id,
            select: true,
            side: landing.side,
            split: landing.split,
          });
          return;
        }
        case "sidebar": {
          const { drop } = landing;
          // The window follows the tab, which stays the one up, as a
          // browser's tab dragged into another window does.
          if (drop.kind === "between") {
            fillRoom(groups.make({ moving: held.id, place: drop.place }));
          } else {
            groups.moveTab(held.id, drop.group);
            groups.show(drop.group);
          }
          return;
        }
        default: {
          return;
        }
      }
    }
    switch (landing.kind) {
      case "sidebar": {
        if (landing.drop.kind === "between") {
          groups.place(held.group, landing.drop.place);
          fillRoom(held.group);
        }
        return;
      }
      // In a strip a group's tabs stand at the gap, in their order, the
      // front one up; at a split target they make a side of their own. The
      // group closes once it has none.
      case "strip":
      case "side": {
        const { front, ids } = tabsOfHeldGroup(held, store.get(windowTabsAtom));
        ids.forEach((id, index) => {
          groups.moveTab(
            id,
            landing.group,
            landing.kind === "strip"
              ? {
                  index: landing.index + index,
                  side: landing.side,
                  split: false,
                }
              : { side: landing.side, split: landing.split && index === 0 },
          );
        });
        if (front !== undefined) {
          windowTabs.select(front);
        }
        return;
      }
      case "window": {
        groups.moveToNewWindow(held.group, openGroups);
        return;
      }
      default: {
        return;
      }
    }
  };

  return (held: Held, landing: Landing | undefined) => {
    const outcome = outcomeOf(held, landing);
    switch (outcome.does) {
      case "keep": {
        if (landing?.kind !== "bookmarks") {
          return;
        }
        keep(
          held.kind === "folder"
            ? [{ id: held.folder, order: 0, title: held.title, url: "" }]
            : keptAs(held, {
                allTabs: windowTabs.allTabs,
                bookmarks: store.get(bookmarksAtom),
                titleOf,
                upOf: (group, half) => {
                  const layout = windowTabs.layoutOf(group);
                  const side = layout.sides[half ?? layout.focused];
                  return side?.tabs.find((tab) => tab.id === side.up);
                },
              }),
          landing,
        );
        return;
      }
      case "move": {
        if (landing && (held.kind === "tab" || held.kind === "group")) {
          moveTo(held, landing);
        }
        return;
      }
      case "open": {
        if (landing) {
          openAt(held, landing);
        }
        return;
      }
      case "unfavorite": {
        const place = placeOf(held);
        if (place?.favorites) {
          removeFavorite(place.path, place.favorites);
        }
        return;
      }
      // Favorites' own target lands a place or files it took, and a
      // composer's box a place.
      case "attach":
      case "into":
      case "favorite":
      case "nothing": {
        return;
      }
    }
  };
}

/**
 * Keeps what is held at a place on the bar or in All Bookmarks, or in one
 * of their folders, in its order (`keptAs`): one kept already, the bookmark held or the one kept
 * for its address, moves there, and anything else is added there.
 */
function useKeepBookmark() {
  const store = useStore();
  const apply = useSetAtom(applyBookmarkOpsAtom);
  return (
    what: readonly Bookmark[],
    landing: Extract<Landing, { kind: "bookmarks" }>,
  ) => {
    const state = store.get(bookmarksStateAtom);
    const { folder, root } = landing;
    // A folder moves along the bar as a bookmark kept there does.
    const keptIds = new Set(
      [...state.bookmarks, ...state.folders].map((each) => each.id),
    );
    const moving = new Set(what.map((each) => each.id));
    const all = siblingsIn(state, folder, root);
    const there = all.filter((each) => !moving.has(each.id));
    const orders = ordersAt(there, landing.index, what.length, all);
    const into =
      folder !== undefined ? { folder } : root === undefined ? {} : { root };
    void apply(
      what.map((each, index): BookmarkOp => {
        const order = orders[index] ?? orderAfter(all);
        if (keptIds.has(each.id)) {
          return { id: each.id, order, type: "move", ...into };
        }
        const bookmark: Bookmark = {
          id: crypto.randomUUID(),
          order,
          title: each.title || each.url,
          url: each.url,
          ...into,
        };
        return { bookmark, type: "add" };
      }),
    );
  };
}

/**
 * What main carries past the window's edges: a group's tab from the first
 * movement, so its picture is ready when the tab leaves the window, and a
 * whole group once its row does. Off the window the tab's strip closes up
 * behind it and the tab beside it comes up, as if it had gone, and its
 * picture goes with the pointer; let go in the open it is a group of its
 * own in a window of its own, and over another window it lands where that
 * window says. A window's only tab, or only group, takes its window along.
 */
function useCarrier() {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const changeTabs = useWindowTabsChange();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  const letGoOfWholeGroup = useLetGoOfWholeGroup();

  const carryTab = (
    held: Extract<Held, { kind: "tab" }>,
    event: PointerEvent,
    grab: Point,
  ): Carry => {
    const state = store.get(windowTabsAtom);
    const isOnlyTab = holdsOnly(held.group, tabsIn(state, held.group), open);
    const select = (key: string) => {
      const id = store
        .get(windowTabsAtom)
        .tabs.find((each) => stripKeyOf(each) === key)?.id;
      if (id !== undefined) {
        windowTabs.bringUp(id);
      }
    };
    let collapses = false;
    let isEnded = false;
    let isNeighborUp = false;
    let wasOff = isOnlyTab;
    // What a drag that lands nowhere puts back: the tab up on each side, and
    // the side with the keyboard, as the press left them.
    const upAtStart = upTabsIn(state, held.group);
    const putBack = () => {
      isNeighborUp = false;
      changeTabs("putUpBack", held.group, upAtStart);
    };
    const showWhereItIs = (isOff: boolean) => {
      const isGone = isOff && collapses && !isEnded;
      if (isGone && !isNeighborUp) {
        const now = store.get(windowTabsAtom);
        const side =
          groupLayoutOf(now, held.group).sides[held.side]?.tabs ?? [];
        const tab = side.find((each) => stripKeyOf(each) === held.key);
        const neighbor =
          tab && nextUpAfter(side, tab.id, now.openers ?? NO_OPENERS);
        if (neighbor) {
          isNeighborUp = true;
          windowTabs.bringUp(neighbor.id);
        }
      } else if (!isGone && isNeighborUp) {
        isNeighborUp = false;
        select(held.key);
      }
    };
    // The press selected the tab, which is what its picture has to show.
    const starting = afterNextPaint().then(async () => {
      const moving = groupTabStanding(store.get(windowTabsAtom), held.key);
      const strip = document
        .querySelector(
          `[data-group-up] [data-group-side="${held.side}"] [role=tablist]`,
        )
        ?.getBoundingClientRect();
      if (isEnded || !moving || !strip) {
        return false;
      }
      // Its picture is its page, as the tab alone in a window of its own;
      // a window's only tab is pictured as the window it takes along.
      const page = isOnlyTab
        ? undefined
        : document
            .querySelector(
              `[data-group-up] [data-group-side="${held.side}"] [data-side-page]`,
            )
            ?.getBoundingClientRect();
      const started = await rpcClient.window.startTabCarry.call({
        // In a window of its own the tab stands first in the strip, so the
        // pointer holds it there at the same point of the tab it pressed.
        grab: { x: strip.left + grab.x, y: event.clientY },
        isOffRow: isOnlyTab,
        isOnlyTab,
        moving,
        ...(page
          ? {
              page: {
                height: page.height,
                width: page.width,
                x: page.left,
                y: page.top,
              },
            }
          : {}),
        pointInTab: grab.x,
      });
      collapses = started.collapsesOffRow;
      showWhereItIs(wasOff);
      return true;
    });
    return {
      cancel: () => {
        isEnded = true;
        putBack();
        void starting
          .then((started) =>
            started
              ? rpcClient.window.endTabCarry.call({ canceled: true })
              : undefined,
          )
          .catch(() => undefined)
          .then(() => {
            showTabCarryView({ kind: "row" });
          });
      },
      followsPointer: isOnlyTab,
      move: (move, isOff) => {
        wasOff = isOff;
        showWhereItIs(isOff);
        void rpcClient.window.noteTabCarry
          .call({ isOffRow: isOff, x: move.screenX, y: move.screenY })
          .catch(() => undefined);
      },
      release: async (up) => {
        const started = await starting.catch(() => false);
        isEnded = true;
        if (!started) {
          putBack();
          return "stays";
        }
        const end = await rpcClient.window.endTabCarry
          .call({ canceled: false, point: { x: up.screenX, y: up.screenY } })
          .catch(() => {
            showTabCarryView({ kind: "row" });
            return { kind: "none" as const };
          });
        settleTabMove(held.key, end);
        if (end.kind === "none") {
          putBack();
        }
        letGoOfWholeGroup(held.key, end, held.group);
        return end.kind === "none" ? "stays" : "gone";
      },
    };
  };

  const carryGroup = (
    held: Extract<Held, { kind: "group" }>,
    grab: Point,
  ): Carry => {
    const isOnly = (store.get(windowTabGroupsAtom) ?? []).length === 1;
    const upAtPress = groups.groupUp();
    let starting: Promise<boolean> | undefined;
    const carry: Carry = {
      cancel: () => {
        void starting
          ?.then((started) =>
            started
              ? rpcClient.window.endTabCarry.call({ canceled: true })
              : undefined,
          )
          .catch(() => undefined)
          .then(() => {
            showTabCarryView({ kind: "row" });
          });
        showBack();
      },
      followsPointer: false,
      move: (move, isOff) => {
        if (isOff && !starting) {
          starting = start(move);
        }
        if (starting) {
          void rpcClient.window.noteTabCarry
            .call({ isOffRow: isOff, x: move.screenX, y: move.screenY })
            .catch(() => undefined);
        }
      },
      release: async (up) => {
        const started = starting ? await starting.catch(() => false) : false;
        if (!started) {
          showBack();
          return "stays";
        }
        const end = await rpcClient.window.endTabCarry
          .call({ canceled: false, point: { x: up.screenX, y: up.screenY } })
          .catch(() => ({ kind: "none" as const }));
        // A window that closes for it goes on showing what it shows until it has gone.
        if (end.kind === "losesTab") {
          groups.letGo(held.group, open);
        }
        if (end.kind === "none") {
          showBack();
        }
        fillRoom(undefined);
        return end.kind === "none" ? "stays" : "gone";
      },
    };
    /** The window back on what it showed at the press. */
    const showBack = () => {
      if (
        upAtPress !== undefined &&
        upAtPress !== groups.groupUp() &&
        store.get(windowTabGroupsAtom)?.includes(upAtPress)
      ) {
        groups.show(upAtPress);
      }
    };
    const start = async (move: PointerEvent) => {
      // The picture that goes with the pointer is of the window showing it.
      if (groups.groupUp() !== held.group) {
        groups.show(held.group);
      }
      // A window's only group takes its window along from here.
      carry.followsPointer = isOnly;
      await afterNextPaint();
      const list = document
        .querySelector("[data-group-list]")
        ?.getBoundingClientRect();
      await rpcClient.window.startTabCarry.call({
        grab: { x: (list?.left ?? 0) + grab.x, y: move.clientY },
        isOffRow: true,
        isOnlyTab: isOnly,
        moving: wholeGroupStanding(store.get(windowTabsAtom), held.group),
        pointInTab: grab.x,
      });
      // Pictured, the group is off with the pointer, and the window is back
      // on what it showed at the press: a group it still has, which a side
      // of takes the one held if it comes back over the window.
      showBack();
      return true;
    };
    return carry;
  };

  return (held: Held, event: PointerEvent, grab: Point): Carry | undefined => {
    if (held.kind === "tab") {
      return carryTab(held, event, grab);
    }
    if (held.kind === "group") {
      return carryGroup(held, grab);
    }
    return undefined;
  };
}

/** Another window's tab, or whole group, as this window holds it. */
function remoteHeldOf(
  view: IncomingTab,
  tabs: readonly WindowTab[],
): Held | undefined {
  const whole = groupOfWholeKey(view.tab.id);
  if (whole !== undefined) {
    return { group: whole, height: ROW_GAP_PX, kind: "group" };
  }
  const tab = tabs.find((each) => stripKeyOf(each) === view.tab.id);
  if (tab?.group === undefined) {
    return undefined;
  }
  return {
    group: tab.group,
    id: tab.id,
    key: view.tab.id,
    kind: "tab",
    side: sideOf(tab),
  };
}

/** Where a landing here is, in the words main passes on to this window when the tab is let go. */
function groupTabLandingOf(
  held: Held,
  landing: Landing | undefined,
): GroupTabLanding | undefined {
  if (!landing) {
    return undefined;
  }
  // A whole group lands among a side's tabs or on a side's page as a tab
  // does, all its tabs with it, and in the sidebar only as a group of its
  // own: one group is never let go into another's row.
  if (
    held.kind === "group" &&
    landing.kind === "sidebar" &&
    landing.drop.kind !== "between"
  ) {
    return undefined;
  }
  switch (landing.kind) {
    case "strip": {
      return { index: landing.index, kind: "tabs", side: landing.side };
    }
    case "side": {
      return { kind: "side", side: landing.side, split: landing.split };
    }
    case "sidebar": {
      return landing.drop.kind === "into"
        ? { group: landing.drop.group, kind: "group" }
        : { at: landing.drop.place, kind: "new" };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Follows what main says of another window's tab, or whole group, held
 * over this one, measures it as any drag here is, and tells main where it
 * lands, which it hands back when the tab is let go (`receiveGroupTab`).
 */
function useRemoteDrags() {
  useTabCarryView();
  const store = useStore();
  const view = useAtomValue(tabCarryViewAtom);
  useLayoutEffect(() => {
    const held =
      view.kind === "incoming"
        ? remoteHeldOf(view, store.get(windowTabsAtom).tabs)
        : undefined;
    if (view.kind !== "incoming" || !held) {
      followRemote(undefined, () => undefined);
      return;
    }
    followRemote(
      {
        grab: {
          x: view.pointInTab,
          y: held.kind === "group" ? held.height / 2 : 0,
        },
        held,
        point: { x: view.clientX, y: view.clientY },
      },
      (landing) => {
        void rpcClient.window.placeGroupTabCarry
          .call({ landing: groupTabLandingOf(held, landing) ?? null })
          .catch(() => undefined);
      },
    );
  }, [store, view]);
}

/**
 * Content the system's drag holds over the window, measured as any drag
 * here is: the one way in for files and links, whether from the Finder,
 * another app or a web page, or from this app's own content (Files, a
 * file card, the address field, a link in a reply, `useContentDrag`). A drag carries only
 * its count until it is let go, so main reads what it carries
 * (`files.dragged`), and until it answers nothing is drawn but where it
 * lands; a link says where it goes only as it is let go. Listens on the
 * window ahead of everything in it, and takes a drag only where it lands:
 * anywhere else it goes on to whatever is under it, Files' folders, the
 * composer that attaches it and the window's last resort among them
 * (`useWindowDropFallback`). What lands is landed by the target it is in,
 * where that target lands what it takes itself, and else by the window's
 * lander (`releaseNative`).
 */
export function useSystemDrags() {
  useEffect(() => {
    let held: ContentHeld | undefined;
    // Entering one element leaves another, so what the drag is over in the
    // window empties only as it leaves the window, or goes over a page,
    // which takes it. One taken out from under it, as a tab making way for
    // it is, never hears it leave.
    const entered = new Set<Node>();
    let point: Point = { x: 0, y: 0 };

    const end = () => {
      unheard.stop();
      held = undefined;
      entered.clear();
      endFromElsewhere("native");
    };
    const unheard = whenUnheard(end);
    /** Whether the drag carries files, or else a link, which is all it takes. */
    const carries = (event: DragEvent) =>
      carriesFiles(event) ||
      (event.dataTransfer?.types.includes("text/uri-list") ?? false);

    /** A drag first seen: how many it carries now, and what they are once main says; a link, which says nothing until it is let go. */
    const begin = (event: DragEvent): NonNullable<typeof held> => {
      if (!carriesFiles(event)) {
        // This window's own link is known by name from the start.
        const own = ownLinkInAir();
        return {
          id: newScreenId(),
          kind: "link",
          title: own?.title ?? "",
          url: own?.url ?? "",
        };
      }
      const count = [...(event.dataTransfer?.items ?? [])].filter(
        (item) => item.kind === "file",
      ).length;
      const started: Extract<Held, { kind: "files" }> = {
        count,
        files: undefined,
        ids: Array.from({ length: count }, () => newScreenId()),
        kind: "files",
      };
      void rpcClient.files.dragged
        .call()
        .then(({ files }) => {
          if (held !== started) {
            return;
          }
          const own = ownFileDragInAir();
          let known: DroppedFile[] | undefined;
          if (files?.length === count) {
            known = files.map((file) => ({
              hostPath: file.path,
              isFolder: file.isFolder,
            }));
          } else if (files === null && own.length === count) {
            // Off the Mac only this app's own drag is known by name, and
            // not which of it are folders.
            known = own.map((hostPath) => ({ hostPath, isFolder: false }));
          }
          if (known) {
            held = { ...started, files: known };
            followNative(held, point);
          }
        })
        .catch(() => undefined);
      return started;
    };

    const over = (event: DragEvent) => {
      if (!carries(event)) {
        return;
      }
      point = { x: event.clientX, y: event.clientY };
      if (!held) {
        held = begin(event);
      }
      if (held.kind === "files") {
        sawOwnFileDrag();
      }
      unheard.heard();
      const landing = followNative(held, point);
      if (landing === "refused") {
        // Where letting go changes nothing, nothing under it hears of it
        // either, and the drag goes unclaimed, so the system's pointer says
        // so and the release drops nothing.
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "none";
        }
      } else if (landing) {
        // Where it lands, nothing under it hears of it, so an editor there
        // draws no caret of its own.
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      }
    };
    const enter = (event: DragEvent) => {
      if (!carries(event)) {
        return;
      }
      if (event.target instanceof Node) {
        entered.add(event.target);
      }
      over(event);
    };
    const leave = (event: DragEvent) => {
      if (!carries(event) || entered.size === 0) {
        return;
      }
      if (event.target instanceof Node) {
        entered.delete(event.target);
      }
      for (const node of entered) {
        if (!node.isConnected) {
          entered.delete(node);
        }
      }
      if (entered.size === 0) {
        end();
      }
    };
    const drop = (event: DragEvent) => {
      if (!carries(event)) {
        return;
      }
      const was = held;
      const released = held
        ? releaseNative({ x: event.clientX, y: event.clientY })
        : undefined;
      unheard.stop();
      held = undefined;
      entered.clear();
      if (!was || !released || !event.dataTransfer) {
        return;
      }
      // Taken here and nowhere else, so the window's last resort leaves it.
      event.preventDefault();
      event.stopPropagation();
      if (released === "refused") {
        releaseSelfFileDrag();
        endOwnFileDrag();
        return;
      }
      const { land, landing } = released;
      if (was.kind === "link") {
        const link = linkOfDrop(event.dataTransfer);
        if (link) {
          land({ ...was, ...link }, landing);
        }
        return;
      }
      releaseSelfFileDrag();
      endOwnFileDrag();
      const files = filesOfDrop(event.dataTransfer);
      if (files.length > 0) {
        land(
          { count: files.length, files, ids: was.ids, kind: "files" },
          landing,
        );
      }
    };

    const options = { capture: true };
    window.addEventListener("dragenter", enter, options);
    window.addEventListener("dragover", over, options);
    window.addEventListener("dragleave", leave, options);
    window.addEventListener("drop", drop, options);
    return () => {
      end();
      window.removeEventListener("dragenter", enter, options);
      window.removeEventListener("dragover", over, options);
      window.removeEventListener("dragleave", leave, options);
      window.removeEventListener("drop", drop, options);
    };
  }, []);
}

/**
 * The link a drop carries: the first address its list gives, and the words
 * it was dragged by, which a page's link carries as the link's own markup.
 */
function linkOfDrop(
  transfer: DataTransfer,
): { title: string; url: string } | undefined {
  const url = transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#"));
  if (!url || !URL.canParse(url)) {
    return undefined;
  }
  const html = transfer.getData("text/html");
  const words = html
    ? new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("a")
        ?.textContent?.replaceAll(/\s+/g, " ")
        .trim()
    : undefined;
  return { title: words && words !== url ? words : "", url };
}
