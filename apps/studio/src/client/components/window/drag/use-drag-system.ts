import { type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";
import { addressOfTab, targetOfAddress } from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { bookmarksAtom, applyBookmarkOpsAtom } from "@/client/bookmarks/store";
import {
  endOwnFileDrag,
  ownFileDragInAir,
  releaseSelfFileDrag,
  sawOwnFileDrag,
} from "@/client/lib/self-file-drag";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { rpcClient } from "@/client/rpc/client";
import {
  type Bookmark,
  type BookmarkPlace,
  inOrder,
  orderAfter,
  placeOf,
} from "@/shared/bookmarks";
import {
  type GroupTabLanding,
  groupOfWholeKey,
  type IncomingTab,
  neighborAt,
} from "@/shared/tabs";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";

import { type BrowserTabsHandle } from "../browser-tabs";
import { useTabTitle } from "../group-sidebar";
import { settleTabMove } from "../move-tab";
import { stripKeyOf } from "../pane-tabs";
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
import {
  useOpenGroups,
  useTabGroupActions,
  windowTabGroupsAtom,
} from "../tab-groups";
import { groupLayoutOf, sideOf, tabsIn } from "../tab-model";
import { newScreenId, useWindowTabs, windowTabsAtom } from "../window-tabs";
import { droppedFileHref, filesOfDrop } from "./held-tabs";
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
import { type DroppedFile, type Held, type Landing } from "./types";

/**
 * How long a drag of files goes unheard from before it is taken to have
 * gone: the system tells the window of a drag held still over it several
 * times a second.
 */
const GONE_AFTER_MS = 1000;

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
  useSystemFileDrags((files, ids, landing) => {
    latest.current.land(
      { count: files.length, files, ids, kind: "files" },
      landing,
    );
  });
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
 * What letting go does where the window's own moves land it: a tab moves
 * among a side's tabs, onto a side's page (as its last tab, or a side of
 * its own), into a sidebar row's group or a group of its own in a room
 * between rows, or onto the bookmarks, where it is kept; files and a
 * bookmark open as tabs at the same places; a whole group takes its place
 * in the list.
 */
function useLander(
  browser: BrowserTabsHandle | null,
  titleOf: (tab: WindowTab) => string,
) {
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const keep = useKeepBookmark();

  /** Opens tabs, by what they show, where something held landed; the first up. */
  const openAt = (
    opens: readonly ((placing: {
      after?: string;
      group: string;
      side?: 0 | 1;
    }) => string | undefined)[],
    landing: Landing,
  ) => {
    const openRest = (group: string, after: string, from: number) => {
      let previous = after;
      for (const open of opens.slice(from)) {
        previous = open({ after: previous, group }) ?? previous;
      }
    };
    const [first] = opens;
    if (!first) {
      return;
    }
    switch (landing.kind) {
      case "strip": {
        const id = first({ group: landing.group, side: landing.side });
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
        openRest(landing.group, id, 1);
        return;
      }
      case "side": {
        const id = first({ group: landing.group });
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
        openRest(landing.group, id, 1);
        return;
      }
      case "sidebar": {
        const { drop } = landing;
        const fill = (group: string) => {
          const id = first({ group });
          if (id !== undefined) {
            windowTabs.select(id);
            openRest(group, id, 1);
          }
        };
        if (drop.kind === "into") {
          fill(drop.group);
          return;
        }
        fillRoom(groups.make({ fill, place: drop.place }));
        return;
      }
      default: {
        return;
      }
    }
  };

  /** What a tab, files or a bookmark open as, one opener each. */
  const openersOf = (held: Held) => {
    if (held.kind === "files") {
      return (held.files ?? []).map(
        (file, index) =>
          (placing: { after?: string; group: string; side?: 0 | 1 }) =>
            windowTabs.openScreen(droppedFileHref(file), {
              ...placing,
              ...(held.ids[index] === undefined ? {} : { id: held.ids[index] }),
            }),
      );
    }
    if (held.kind === "bookmark") {
      const target = targetOfAddress(held.url);
      if (!target) {
        return [];
      }
      return [
        (placing: { after?: string; group: string; side?: 0 | 1 }) =>
          target.kind === "page"
            ? browser?.open(target.url, placing)
            : windowTabs.openScreen(hrefOfTarget(target), placing),
      ];
    }
    return [];
  };

  return (held: Held, landing: Landing) => {
    switch (held.kind) {
      case "tab": {
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
          case "bookmarks": {
            const tab = windowTabs.allTabs.find((each) => each.id === held.id);
            const url = tab ? addressOfTab(tab) : undefined;
            if (tab && url !== undefined) {
              keep({ title: titleOf(tab), url }, landing);
            }
            return;
          }
          default: {
            return;
          }
        }
      }
      case "group": {
        if (landing.kind === "sidebar" && landing.drop.kind === "between") {
          groups.place(held.group, landing.drop.place);
          fillRoom(held.group);
        }
        return;
      }
      case "files": {
        if (landing.kind === "newTab") {
          const [first, ...rest] = openersOf(held);
          const [file] = held.files ?? [];
          if (!first || !file) {
            return;
          }
          windowTabs.visitHref(landing.tab, droppedFileHref(file));
          windowTabs.select(landing.tab);
          let previous = landing.tab;
          for (const open of rest) {
            previous =
              open({ after: previous, group: landing.group }) ?? previous;
          }
          return;
        }
        openAt(openersOf(held), landing);
        return;
      }
      case "bookmark": {
        if (landing.kind === "bookmarks") {
          keep({ id: held.id, title: held.title, url: held.url }, landing);
          return;
        }
        openAt(openersOf(held), landing);
        return;
      }
    }
  };
}

/**
 * Keeps an address on the bar or in the sidebar's Bookmarks at a place
 * among the bookmarks there: a bookmark already kept moves there, wherever
 * it was.
 */
function useKeepBookmark() {
  const store = useStore();
  const apply = useSetAtom(applyBookmarkOpsAtom);
  return (
    what: { id?: string; title: string; url: string },
    landing: Extract<Landing, { kind: "bookmarks" }>,
  ) => {
    const all = store.get(bookmarksAtom);
    const kept =
      what.id === undefined
        ? undefined
        : all.find((bookmark) => bookmark.id === what.id);
    const there = inOrder(all).filter(
      (bookmark) =>
        placeOf(bookmark) === landing.where && bookmark.id !== kept?.id,
    );
    const order = orderAt(there, landing.index, all);
    if (kept) {
      void apply([
        placeOf(kept) === landing.where
          ? { id: kept.id, order, type: "move" }
          : { id: kept.id, order, type: "place", where: landing.where },
      ]);
      return;
    }
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      order,
      title: what.title || what.url,
      url: what.url,
      ...(landing.where === "sidebar"
        ? { where: "sidebar" as BookmarkPlace }
        : {}),
    };
    void apply([{ bookmark, type: "add" }]);
  };
}

/** The order that sorts a bookmark at a place among others, halfway between its neighbors. */
function orderAt(
  there: readonly Bookmark[],
  index: number,
  all: readonly Bookmark[],
) {
  const before = there[index - 1];
  const after = there[index];
  if (before && after) {
    return (before.order + after.order) / 2;
  }
  if (after) {
    return after.order - 1;
  }
  return before ? before.order + 1 : orderAfter(all);
}

/**
 * Removes a bookmark dragged off where it is kept, with Undo in a toast
 * that puts it back as it was.
 */
export function useRemoveBookmarkWithUndo() {
  const apply = useSetAtom(applyBookmarkOpsAtom);
  return (bookmark: Bookmark) => {
    void apply([{ id: bookmark.id, type: "remove" }]);
    toast(`Removed ${bookmark.title || "the bookmark"}.`, {
      action: {
        label: "Undo",
        onClick: () => {
          void apply([{ bookmark, type: "add" }]);
        },
      },
    });
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
    const order = (
      groupLayoutOf(state, held.group).sides[held.side]?.tabs ?? []
    ).map(stripKeyOf);
    const select = (key: string) => {
      const id = store
        .get(windowTabsAtom)
        .tabs.find((each) => stripKeyOf(each) === key)?.id;
      if (id !== undefined) {
        windowTabs.select(id);
      }
    };
    let collapses = false;
    let isEnded = false;
    let isNeighborUp = false;
    let wasOff = isOnlyTab;
    const showWhereItIs = (isOff: boolean) => {
      const isGone = isOff && collapses && !isEnded;
      if (isGone && !isNeighborUp) {
        const neighbor = neighborAt(order, order.indexOf(held.key));
        if (neighbor !== undefined) {
          isNeighborUp = true;
          select(neighbor);
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
        .querySelector(`[data-group-side="${held.side}"] [role=tablist]`)
        ?.getBoundingClientRect();
      if (isEnded || !moving || !strip) {
        return false;
      }
      const started = await rpcClient.window.startTabCarry.call({
        at: { x: event.screenX, y: event.screenY },
        // In a window of its own the tab stands first in the strip, so the
        // pointer holds it there at the same point of the tab it pressed.
        grab: { x: strip.left + grab.x, y: event.clientY },
        isOffRow: isOnlyTab,
        isOnlyTab,
        moving,
        pointInTab: grab.x,
      });
      collapses = started.collapsesOffRow;
      showWhereItIs(wasOff);
      return true;
    });
    return {
      cancel: () => {
        isEnded = true;
        showWhereItIs(false);
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
          showWhereItIs(false);
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
          showWhereItIs(false);
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
        at: { x: move.screenX, y: move.screenY },
        grab: { x: (list?.left ?? 0) + grab.x, y: move.clientY },
        isOffRow: true,
        isOnlyTab: isOnly,
        moving: wholeGroupStanding(store.get(windowTabsAtom), held.group),
        pointInTab: grab.x,
      });
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
  if (held.kind === "group") {
    return landing.kind === "sidebar" && landing.drop.kind === "between"
      ? { at: landing.drop.place, kind: "new" }
      : undefined;
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
 * Files the system's drag holds over the window, from the Finder or from
 * this app's own Files and file cards, measured as any drag here is. A drag
 * carries only its count until it is let go, so main reads what it carries
 * (`files.dragged`), and until it answers nothing is drawn but where it
 * lands. Listens on the window ahead of everything in it, and takes a drag
 * only where it lands: anywhere else it goes on to whatever is under it,
 * Files' folders, the composer that attaches it and the window's last
 * resort among them (`useWindowDropFallback`).
 */
function useSystemFileDrags(
  onLand: (
    files: readonly DroppedFile[],
    ids: readonly string[],
    landing: Landing,
  ) => void,
) {
  const onLandRef = useRef(onLand);
  useLayoutEffect(() => {
    onLandRef.current = onLand;
  });
  useEffect(() => {
    let held: Extract<Held, { kind: "files" }> | undefined;
    // Entering one element leaves another, so what the drag is over in the
    // window empties only as it leaves the window, or goes over a page,
    // which takes it. One taken out from under it, as a tab making way for
    // it is, never hears it leave.
    const entered = new Set<Node>();
    let goneTimer: number | undefined;
    let point: Point = { x: 0, y: 0 };

    const end = () => {
      window.clearTimeout(goneTimer);
      held = undefined;
      entered.clear();
      endFromElsewhere("native");
    };
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;

    /** A drag first seen: how many it carries now, and what they are once main says. */
    const begin = (event: DragEvent) => {
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
      if (!hasFiles(event)) {
        return;
      }
      point = { x: event.clientX, y: event.clientY };
      if (!held) {
        held = begin(event);
      }
      sawOwnFileDrag();
      window.clearTimeout(goneTimer);
      goneTimer = window.setTimeout(end, GONE_AFTER_MS);
      if (followNative(held, point)) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      }
    };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      if (event.target instanceof Node) {
        entered.add(event.target);
      }
      over(event);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event) || entered.size === 0) {
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
      if (!hasFiles(event)) {
        return;
      }
      const ids = held?.ids ?? [];
      const landing = held
        ? releaseNative({ x: event.clientX, y: event.clientY })
        : undefined;
      window.clearTimeout(goneTimer);
      held = undefined;
      entered.clear();
      if (!landing || !event.dataTransfer) {
        return;
      }
      // Taken here and nowhere else, so the window's last resort leaves it.
      event.preventDefault();
      event.stopPropagation();
      releaseSelfFileDrag();
      endOwnFileDrag();
      const files = filesOfDrop(event.dataTransfer);
      if (files.length > 0) {
        onLandRef.current(files, ids, landing);
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
