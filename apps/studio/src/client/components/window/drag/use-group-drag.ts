import { isPlaceDragInAir } from "@/client/lib/self-file-drag";
import { type WindowTab } from "@/client/atoms/window";
import { getDefaultStore, useAtomValue } from "jotai";
import { useRef } from "react";

import { windowTabGroupsAtom } from "../open-groups";
import { stripKeyOf } from "../pane-tabs";
import { stripIndexAt } from "../tab-carry-view";
import { type GroupLayout, isHomeTab, sideIndexOf } from "../tab-model";
import { useWindowTabs } from "../window-tabs";
import { heldKeysOf, heldTabsOf } from "./held-tabs";
import {
  holds,
  onPages,
  pagesReach,
  type Point,
  type Rect,
  sideZoneAt,
  splitTargetsOf,
} from "./landing";
import { currentDrag, dragAtom, pressToDrag, useDropTarget } from "./session";
import { type Held } from "./types";

/**
 * How far past a strip's row, up and down, something held still stands
 * among its tabs: a hand sweeping along the row drifts off it and means
 * nothing by that.
 */
const STRIP_REACH_PX = 14;

/** The part of a rect inside another, if any. */
function clipped(rect: Rect, by: Rect): Rect | undefined {
  const left = Math.max(rect.left, by.left);
  const top = Math.max(rect.top, by.top);
  const right = Math.min(rect.left + rect.width, by.left + by.width);
  const bottom = Math.min(rect.top + rect.height, by.top + by.height);
  return right > left && bottom > top
    ? { height: bottom - top, left, top, width: right - left }
    : undefined;
}

function rectOf(element: Element | null | undefined): Rect | undefined {
  if (!element) {
    return undefined;
  }
  const { height, left, top, width } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { height, left, top, width } : undefined;
}

/**
 * A side's strip as a drag draws it: what is held standing among its tabs
 * where it would land, the first of it at the pointer and up, the rest
 * making room; or a tab of its own held anywhere else given up, its
 * neighbors closing over its place.
 */
export function useSideStrip({
  group,
  side,
  tabs,
}: {
  group: string;
  side: 0 | 1;
  tabs: WindowTab[];
}): {
  carriedKey?: string;
  chosenId?: string;
  heldAt?: { grabX: number; key: string };
  isIncoming: boolean;
  tabs: WindowTab[];
} {
  const drag = useAtomValue(dragAtom);
  const { allTabs, layoutOf } = useWindowTabs();
  if (!drag) {
    return { isIncoming: false, tabs };
  }
  const { held, landing } = drag;
  const isFromHere =
    held.kind === "tab" && held.group === group && held.side === side;
  if (
    landing?.kind !== "strip" ||
    landing.group !== group ||
    landing.side !== side
  ) {
    return isFromHere
      ? { carriedKey: held.key, isIncoming: false, tabs }
      : { isIncoming: false, tabs };
  }
  // A whole group stands as all its tabs, in their order.
  const heldTabs =
    held.kind === "group"
      ? layoutOf(held.group).sides.flatMap((each) => each.tabs)
      : heldTabsOf(held, allTabs);
  const [first] = heldTabs;
  if (!first) {
    return { isIncoming: false, tabs };
  }
  const keys = heldKeysOf(held);
  const others = tabs.filter((tab) => !keys.includes(stripKeyOf(tab)));
  return {
    chosenId: first.id,
    heldAt: { grabX: drag.grab.x, key: stripKeyOf(first) },
    isIncoming: drag.input === "remote",
    tabs: others.toSpliced(landing.index, 0, ...heldTabs),
  };
}

/**
 * A side's strip as a place to land: a tab, files or a bookmark held over
 * it, or just above or below it, stands among its tabs where its left edge
 * is (`stripIndexAt`), its neighbors making room.
 */
export function useStripTarget({
  group,
  isOn,
  side,
  strip,
  tabs,
}: {
  group: string;
  /** Whether the strip is up, in the window's tab up. */
  isOn: boolean;
  side: 0 | 1;
  /** The strip's element (`data-group-tabs`). */
  strip: () => HTMLElement | null | undefined;
  tabs: readonly WindowTab[];
}) {
  const { layoutOf } = useWindowTabs();
  useDropTarget(
    isOn
      ? {
          landingAt: (point, { grab, held, input }) => {
            const root = strip();
            // A group lands its tabs in another group's strip, and only from
            // this window, as at a split target.
            if (
              !root ||
              (held.kind === "group" &&
                (held.group === group || input === "remote"))
            ) {
              return undefined;
            }
            // A group held over the strip is drawn there as its tabs
            // (`useSideStrip`), which are left out as one, as a tab is.
            const heldKeys =
              held.kind === "group"
                ? layoutOf(held.group).sides.flatMap((each) =>
                    each.tabs.map(stripKeyOf),
                  )
                : heldKeysOf(held);
            const index = stripIndexAt(
              point.x - grab.x,
              tabs.map((tab) => ({ id: stripKeyOf(tab) })),
              heldKeys,
              root,
            );
            return { group, index, kind: "strip", side };
          },
          rect: () => {
            const rect = rectOf(strip());
            return rect
              ? {
                  ...rect,
                  height: rect.height + STRIP_REACH_PX * 2,
                  top: rect.top - STRIP_REACH_PX,
                }
              : undefined;
          },
          scrolls: {
            axis: "x",
            element: () =>
              strip()?.querySelector<HTMLElement>("[data-strip-scroller]"),
          },
        }
      : undefined,
  );
}

/** What the held thing is to a group's sides: where it stands among them, if it is a tab of the group. */
function heldInGroup(held: Held, group: string, layout: GroupLayout) {
  if (held.kind !== "tab" || held.group !== group) {
    return {};
  }
  const side = sideIndexOf(layout, held.id);
  const alone =
    side !== undefined && (layout.sides[side]?.tabs.length ?? 0) <= 1;
  return side === undefined ? {} : { isAlone: alone, side };
}

/**
 * Whether what a side's page shows takes files at a point itself: a chat's
 * composer and a folder in Files do (`data-file-drop-region`), a folder
 * never a place of Files' sidebar (`isPlaceDragInAir`), and so does
 * anything standing over the page there, as a dialog does. Nothing else in a
 * page does, an open file's editor included, so files let go there open
 * beside it as tabs instead of going into it.
 */
function takesFilesItself(page: Element | null | undefined, point: Point) {
  const under = document.elementFromPoint(point.x, point.y);
  if (!page || !under || !page.contains(under)) {
    return true;
  }
  const region = under.closest("[data-file-drop-region]");
  // A place of Files' sidebar goes into no folder, so over one it opens on
  // the side instead.
  if (region?.hasAttribute("data-folder-drop") && isPlaceDragInAir()) {
    return false;
  }
  return region !== null && page.contains(region);
}

/**
 * Whether files let go at a point over a new tab nobody has written in go
 * to its composer, as the first message's attachments: only over the
 * composer itself (`data-attaches-files`). Anywhere else on the tab the
 * tab turns into them, as a browser's new tab does.
 */
function attachesToNewTab(page: Element | null | undefined, point: Point) {
  const under = document.elementFromPoint(point.x, point.y);
  const box = under?.closest("[data-attaches-files]");
  return box !== null && box !== undefined && page?.contains(box) === true;
}

/**
 * A group's sides' pages as a place to land: with one side, a split target
 * at each end makes that half a side of its own once the pointer nears it
 * (`sideZoneAt`), and the middle joins the side; with two, the side under
 * the pointer takes it as its last tab. The margin between an outer page
 * and the window's edge counts as that page's end (`pagesReach`). Files
 * open as tabs the same way, except where the page takes them itself: a
 * site, and away from a lone side's ends, a chat's composer or a folder in
 * Files (`takesFilesItself`); a new tab up nobody has written in turns into
 * them, except over its composer, which attaches them (`attachesToNewTab`),
 * and into a link away from a lone side's ends. A link opens as its tab
 * wherever a tab would land. The split targets show from the start of a drag that could make one a
 * side. A whole group pulled out of the sidebar makes a side of all its
 * tabs at a split target, and anywhere else on the pages goes to a window
 * of its own, where the window has another group to show.
 *
 * While a side made at an end slides in to show what letting go makes
 * (`useSplitPreview`), the pages are measured as they stood before it, so
 * what lands where stays put under the pointer.
 */
export function useSidePagesTarget({
  group,
  isOn,
  layout,
  scroller,
}: {
  group: string;
  /** Whether the group is up, in the window's tab up. */
  isOn: boolean;
  layout: GroupLayout;
  /** The row the sides stand in, scrolling sideways (`data-side-page` under it). */
  scroller: () => HTMLElement | null;
}) {
  const pageOf = (side: number) =>
    scroller()?.querySelector(`[data-side-page="${side}"]`);
  // The pages as they stood before a side slid in to show a split, or as it
  // slides out again.
  const before = useRef<Rect[]>(undefined);
  // Each side's page as much of it as the row shows, scrolled sideways.
  const pages = () => {
    const row = scroller();
    const isShowingSplit =
      row?.querySelector("[data-side-preview], [data-side-leaving]") != null;
    if (isShowingSplit && before.current) {
      return before.current;
    }
    const shown = rectOf(row);
    const measured = layout.sides.flatMap((_, side) => {
      const rect = rectOf(pageOf(side));
      const cut = rect && shown ? clipped(rect, shown) : undefined;
      return cut ? [cut] : [];
    });
    if (!isShowingSplit) {
      before.current = measured;
    }
    return measured;
  };
  const upOf = (side: number) =>
    layout.sides[side]?.tabs.find((tab) => tab.id === layout.sides[side]?.up);
  /** Whether a tab is a new tab nobody has written in, which turns into files let go over it. */
  const isNewTab = (tab: WindowTab | undefined) =>
    tab !== undefined && isHomeTab(tab);
  /** Whether files over a side's page go to the whole of it, a new tab turning into them or a site taking them, so neither end splits. */
  const takesFilesWhole = (side: number) => {
    const up = upOf(side);
    return up?.kind === "page" || isNewTab(up);
  };
  /** Whether a group held here may go to a window of its own: one this window shows another group beside. */
  const mayLeave = () =>
    (getDefaultStore().get(windowTabGroupsAtom)?.length ?? 0) > 1;
  /** Whether a held group's tabs may make a side here: another group's, held in this window. */
  const maySplitGroup = (held: Held, input: string) =>
    held.kind !== "group" || (held.group !== group && input !== "remote");
  useDropTarget(
    isOn
      ? {
          hints: ({ held, input }) => {
            if (
              !maySplitGroup(held, input) ||
              (held.kind === "files" && takesFilesWhole(0))
            ) {
              return [];
            }
            return splitTargetsOf({
              held: heldInGroup(held, group, layout),
              sides: pages(),
            });
          },
          landingAt: (reached, { held, input }) => {
            const sides = pages();
            const point = onPages(reached, sides);
            const at = sides.findIndex((rect) => holds(rect, point));
            const up = upOf(at);
            if (held.kind === "group" && input === "remote") {
              return undefined;
            }
            if (held.kind === "files") {
              const page = sides[at];
              if (page && up && isNewTab(up)) {
                return attachesToNewTab(pageOf(at), point)
                  ? "native"
                  : { group, kind: "newTab", lit: page, tab: up.id };
              }
              // A site takes files the way it takes them from the Finder,
              // only by the system's drag.
              if (up?.kind === "page") {
                return "native";
              }
            }
            const was = currentDrag()?.landing;
            const zone = maySplitGroup(held, input)
              ? sideZoneAt({
                  held: heldInGroup(held, group, layout),
                  ...(was?.kind === "side" && was.split && was.group === group
                    ? { lit: was.side }
                    : {}),
                  point,
                  sides,
                })
              : undefined;
            if (held.kind === "group" && zone?.kind !== "split") {
              return at !== -1 && mayLeave() ? { kind: "window" } : undefined;
            }
            if (
              held.kind === "files" &&
              zone?.kind !== "split" &&
              takesFilesItself(pageOf(at), point)
            ) {
              return "native";
            }
            // A new tab nobody has written in turns into a link let go on it.
            const page = sides[at];
            if (
              held.kind === "link" &&
              zone?.kind !== "split" &&
              page &&
              up &&
              isNewTab(up)
            ) {
              return { group, kind: "newTab", lit: page, tab: up.id };
            }
            return zone
              ? {
                  group,
                  kind: "side",
                  lit: zone.lit,
                  side: zone.side,
                  split: zone.kind === "split",
                }
              : undefined;
          },
          rect: () => pagesReach(pages(), window.innerWidth),
          scrolls: { axis: "x", element: scroller },
        }
      : undefined,
  );
}

/**
 * A press on a side's tab, which past the start becomes the tab held, by
 * where in the tab the press was.
 */
export function pressSideTab(
  event: React.PointerEvent<HTMLElement>,
  { group, side, tab }: { group: string; side: 0 | 1; tab: WindowTab },
) {
  const element = event.currentTarget;
  const pressedAt = { x: event.clientX, y: event.clientY };
  pressToDrag(event, () => {
    const bounds = element.getBoundingClientRect();
    return {
      grab: { x: pressedAt.x - bounds.left, y: pressedAt.y - bounds.top },
      held: { group, id: tab.id, key: stripKeyOf(tab), kind: "tab", side },
    };
  });
}
