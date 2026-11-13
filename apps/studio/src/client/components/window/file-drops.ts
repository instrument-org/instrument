import { type WindowTab } from "@/client/atoms/window";
import {
  endOwnFileDrag,
  ownFileDragInAir,
  releaseSelfFileDrag,
  sawOwnFileDrag,
} from "@/client/lib/self-file-drag";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { atom, getDefaultStore, type PrimitiveAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";

import { stripKeyOf } from "./pane-tabs";
import {
  heldOverSidebarAtom,
  type SidebarDrop,
  sidebarDropAt,
  sidebarDropAtom,
} from "./sidebar-drop";
import { stripIndexAt } from "./tab-carry-view";
import { useTabGroupActions } from "./tab-groups";
import { tabsIn } from "./tab-model";
import {
  groupOnScreenAtom,
  newScreenId,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

/** A file or folder dragged into the window, by where it is on the computer. */
export interface DroppedFile {
  hostPath: string;
  isFolder: boolean;
}

/** The tab a file opens as, as opening it in Files does, or Files at a folder. */
function droppedFileHref({ hostPath, isFolder }: DroppedFile) {
  return isFolder ? folderHref(hostPath) : fileHref(hostPath);
}

/**
 * Where files let go over the window land, as a tab let go at the same spot
 * does: in the group of a sidebar row; as a group of their own over New or
 * the list's empty space; among the tabs of the group up, at a place along
 * its strip; or in place of the new tab up.
 */
export type FileLanding =
  | { group: string; index: number; kind: "tabs" }
  | { group: string; kind: "into" }
  | { group: string; kind: "newTab"; tab: string }
  | { kind: "new" };

/**
 * Files held over the strip or a new tab of the group up: where they land,
 * the tabs they would be (under ids kept for the drag, which the tabs open
 * under), and where the pointer is along the strip.
 */
interface HeldFiles {
  clientX: number;
  landing: Extract<FileLanding, { kind: "newTab" | "tabs" }>;
  tabs: readonly WindowTab[];
}

export const heldFilesAtom = atom<HeldFiles | undefined>(undefined);

/** Where along a held file's tab the pointer is, so its mark is under it. */
const FILE_GRAB_PX = 18;

/**
 * How long a drag goes unheard from before it is taken to have gone: the
 * system tells the window of a drag held still over it several times a
 * second.
 */
const GONE_AFTER_MS = 1000;

/** What a tab group's strip of tabs is found under. */
const GROUP_TABS = "[data-group-tabs]";

/**
 * A group's tabs as its strip draws them while files are held over it: the
 * files' tabs among them where they would land, the first up and at the
 * pointer, or the new tab they would turn into showing the first of them.
 */
export function stripWithHeldFiles(
  group: string | undefined,
  tabs: readonly WindowTab[],
  held: HeldFiles | undefined,
):
  | undefined
  | {
      chosenId?: string;
      heldAt?: { key: string; left: number };
      tabs: WindowTab[];
    } {
  if (!held || group === undefined || held.landing.group !== group) {
    return undefined;
  }
  const [first, ...rest] = held.tabs;
  if (!first || first.kind !== "screen") {
    return undefined;
  }
  if (held.landing.kind === "tabs") {
    return {
      chosenId: first.id,
      heldAt: { key: first.id, left: held.clientX - FILE_GRAB_PX },
      tabs: tabs.toSpliced(held.landing.index, 0, ...held.tabs),
    };
  }
  const into = held.landing.tab;
  return {
    tabs: tabs.flatMap((tab) =>
      tab.id === into && tab.kind === "screen"
        ? [{ ...tab, href: first.href }, ...rest]
        : [tab],
    ),
  };
}

function contains(element: Element, x: number, y: number) {
  const { bottom, left, right, top } = element.getBoundingClientRect();
  return x >= left && x < right && y >= top && y < bottom;
}

/** What a drag of files over the window is known to carry. */
interface Drag {
  /** How many things it carries, which a page hears from the start. */
  count: number;
  /** What they are, once main has read them off the drag. */
  files: readonly DroppedFile[] | undefined;
  /** The ids their tabs are drawn under while held, and open under. */
  ids: readonly string[];
}

/** Where something held at a point lands, and what the sidebar shows for it. */
function landingAt(
  x: number,
  y: number,
): {
  isOverSidebar: boolean;
  landing: FileLanding | undefined;
  sidebar: SidebarDrop | undefined;
} {
  const store = getDefaultStore();
  const state = store.get(windowTabsAtom);
  const groupUp = store.get(groupOnScreenAtom);
  const nothing = {
    isOverSidebar: false,
    landing: undefined,
    sidebar: undefined,
  };
  const strip = [...document.querySelectorAll(GROUP_TABS)].find((each) =>
    contains(each, x, y),
  );
  if (strip) {
    if (groupUp === undefined) {
      return nothing;
    }
    const held = store.get(heldFilesAtom);
    const index = stripIndexAt(
      x - FILE_GRAB_PX,
      tabsIn(state, groupUp).map((tab) => ({ id: tab.id })),
      held?.landing.kind === "tabs" ? held.tabs.map((tab) => tab.id) : [],
      GROUP_TABS,
    );
    return {
      ...nothing,
      landing: { group: groupUp, index, kind: "tabs" },
    };
  }
  const newTab = [
    ...document.querySelectorAll<HTMLElement>("[data-drop-new-tab]"),
  ].find((each) => contains(each, x, y));
  const newTabId = newTab?.dataset.dropNewTab;
  if (newTabId !== undefined) {
    const group = state.tabs.find((tab) => tab.id === newTabId)?.group;
    return group === undefined
      ? nothing
      : { ...nothing, landing: { group, kind: "newTab", tab: newTabId } };
  }
  const { drop, isOver } = sidebarDropAt(x, y, {
    carries: "tab",
    from: undefined,
  });
  if (drop?.kind === "into") {
    return {
      isOverSidebar: true,
      landing: { group: drop.group, kind: "into" },
      sidebar: drop,
    };
  }
  if (drop?.kind === "new") {
    return { isOverSidebar: true, landing: { kind: "new" }, sidebar: drop };
  }
  return { ...nothing, isOverSidebar: isOver };
}

/** The tabs files would be, one each, under the drag's ids. */
function tabsOf(drag: Drag, group: string | undefined): WindowTab[] {
  return (drag.files ?? []).map((file, index) => ({
    ...(group === undefined ? {} : { group }),
    href: droppedFileHref(file),
    id: drag.ids[index] ?? newScreenId(),
    kind: "screen",
  }));
}

/** Sets an atom only when what it holds changes. */
function showIn<T>(target: PrimitiveAtom<T>, next: T) {
  const store = getDefaultStore();
  if (JSON.stringify(store.get(target)) !== JSON.stringify(next)) {
    store.set(target, next);
  }
}

/** The files a drop carries, by path, folders told from files. */
export function filesOfDrop(transfer: DataTransfer): DroppedFile[] {
  return [...transfer.items].flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    const hostPath = file ? window.api.getFilePath(file) : "";
    return hostPath
      ? [{ hostPath, isFolder: item.webkitGetAsEntry()?.isDirectory ?? false }]
      : [];
  });
}

/**
 * Files and folders dragged over the window, from its own Files or from
 * anywhere else, land where a tab dragged there does (`FileLanding`), and
 * look the part on the way: over the sidebar the row they would join takes
 * its selected tone, or New or the empty list lights, and the first of them
 * goes at the pointer as a row (`heldOverSidebarAtom`); over the strip of
 * the group up their tabs stand among its tabs, the first at the pointer,
 * the rest making room (`heldFilesAtom`); over a new tab up, that tab shows
 * the first of them. A drag carries only its count until it is let go, so
 * main reads what it carries off the system's drag (`files.dragged`), and
 * until it answers nothing is drawn but where it lands.
 *
 * Listens on the window ahead of everything in it, and takes a drag only
 * where it lands: anywhere else it goes on to whatever is under it, the
 * composer that attaches it and the window's last resort among them
 * (`useWindowDropFallback`).
 */
export function useFileDrops(
  onLand: (
    files: readonly DroppedFile[],
    landing: FileLanding,
    ids: readonly string[],
  ) => void,
) {
  const onLandRef = useRef(onLand);
  useEffect(() => {
    onLandRef.current = onLand;
  });

  useEffect(() => {
    let drag: Drag | undefined;
    // Entering one element leaves another, so what the drag is over in the
    // window empties only as it leaves the window, or goes over a page, which
    // takes it. One taken out from under it, as a tab making way for it is,
    // never hears it leave.
    const entered = new Set<Node>();
    let goneTimer: number | undefined;
    /** Where the pointer was last heard of. */
    let point = { clientX: 0, clientY: 0 };
    /** Whether anything is drawn for the drag, which only it takes down. */
    let isShowing = false;

    const show = (at: ReturnType<typeof landingAt>) => {
      const { landing } = at;
      const held =
        drag && landing && landing.kind !== "into" && landing.kind !== "new"
          ? {
              clientX: point.clientX,
              landing,
              tabs: tabsOf(drag, landing.group),
            }
          : undefined;
      const tabs = drag ? tabsOf(drag, undefined) : [];
      const [first] = tabs;
      const overSidebar =
        at.isOverSidebar && first
          ? { ...point, files: tabs, key: first.id }
          : undefined;
      if (!isShowing && !held && !at.sidebar && !overSidebar) {
        return;
      }
      isShowing = true;
      showIn(heldFilesAtom, held);
      showIn(sidebarDropAtom, at.sidebar);
      showIn(heldOverSidebarAtom, overSidebar);
    };

    const end = () => {
      window.clearTimeout(goneTimer);
      drag = undefined;
      entered.clear();
      show({ isOverSidebar: false, landing: undefined, sidebar: undefined });
      isShowing = false;
    };

    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;

    /** A drag first seen: how many it carries now, and what they are once main says. */
    const begin = (event: DragEvent): Drag => {
      const count = [...(event.dataTransfer?.items ?? [])].filter(
        (item) => item.kind === "file",
      ).length;
      const started: Drag = {
        count,
        files: undefined,
        ids: Array.from({ length: count }, () => newScreenId()),
      };
      void rpcClient.files.dragged
        .call()
        .then(({ files }) => {
          if (drag !== started) {
            return;
          }
          const own = ownFileDragInAir();
          if (files?.length === count) {
            started.files = files.map((file) => ({
              hostPath: file.path,
              isFolder: file.isFolder,
            }));
          } else if (files === null && own.length === count) {
            // Off the Mac only this app's own drag is known by name, and
            // not which of it are folders.
            started.files = own.map((hostPath) => ({
              hostPath,
              isFolder: false,
            }));
          }
          show(landingAt(point.clientX, point.clientY));
        })
        .catch(() => undefined);
      return started;
    };

    const over = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      point = { clientX: event.clientX, clientY: event.clientY };
      drag ??= begin(event);
      sawOwnFileDrag();
      window.clearTimeout(goneTimer);
      goneTimer = window.setTimeout(end, GONE_AFTER_MS);
      const at = landingAt(event.clientX, event.clientY);
      show(at);
      if (at.landing) {
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
      const { landing } = landingAt(event.clientX, event.clientY);
      const ids = drag?.ids ?? [];
      end();
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
        onLandRef.current(files, landing, ids);
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
 * What files let go where they land do there, one tab each, the first up:
 * they join a group behind what the window shows; make a group of their own
 * at the top of the list, which the window comes up on; stand among the tabs
 * of the group up where they were let go, under the ids their tabs were
 * drawn under while held; or turn the new tab up into the first of them,
 * the rest right after it.
 */
export function useLandFiles() {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  return (
    files: readonly DroppedFile[],
    landing: FileLanding,
    ids: readonly string[] = [],
  ) => {
    const hrefs = files.map(droppedFileHref);
    /** Opens the files from `from` on in a group, answering their tabs' ids, and brings up the first. */
    const openIn = (group: string, from = 0) => {
      const opened = hrefs.slice(from).flatMap((href, index) => {
        const id = ids[from + index];
        const at = windowTabs.openScreen(href, {
          group,
          ...(id === undefined ? {} : { id }),
        });
        return at === undefined ? [] : [at];
      });
      const [first] = opened;
      if (first !== undefined && from === 0) {
        windowTabs.select(first);
      }
      return opened;
    };
    /** Puts tabs of a group at a place among the rest. */
    const placeAt = (group: string, index: number, keys: readonly string[]) => {
      const rest = tabsIn(store.get(windowTabsAtom), group)
        .map(stripKeyOf)
        .filter((key) => !keys.includes(key));
      windowTabs.reorder(rest.toSpliced(index, 0, ...keys), group);
    };
    switch (landing.kind) {
      case "into": {
        openIn(landing.group);
        return;
      }
      case "new": {
        groups.make({
          fill: (group) => {
            openIn(group);
          },
        });
        return;
      }
      case "newTab": {
        const [first] = hrefs;
        if (first === undefined) {
          return;
        }
        windowTabs.visitHref(landing.tab, first);
        const tabs = tabsIn(store.get(windowTabsAtom), landing.group);
        const at = tabs.findIndex((tab) => tab.id === landing.tab);
        placeAt(landing.group, at + 1, openIn(landing.group, 1));
        windowTabs.select(landing.tab);
        return;
      }
      case "tabs": {
        placeAt(landing.group, landing.index, openIn(landing.group));
        return;
      }
    }
  };
}
