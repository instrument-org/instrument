import { type WindowTab } from "@/client/atoms/window";
import { useAtomValue } from "jotai";

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
  splitBands,
} from "./landing";
import { dragAtom, pressToDrag, useDropTarget } from "./session";
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
  const { allTabs } = useWindowTabs();
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
  const heldTabs = heldTabsOf(held, allTabs);
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
  useDropTarget(
    isOn
      ? {
          landingAt: (point, { grab, held }) => {
            const root = strip();
            if (held.kind === "group" || !root) {
              return undefined;
            }
            const index = stripIndexAt(
              point.x - grab.x,
              tabs.map((tab) => ({ id: stripKeyOf(tab) })),
              heldKeysOf(held),
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
 * composer and a folder in Files do (`data-file-drop-region`), and so does
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
 * A group's sides' pages as a place to land: with one side, its left or
 * right end makes that half a side of its own, and its middle joins the
 * side; with two, the side under the pointer takes it as its last tab. The
 * margin between an outer page and the window's edge counts as that page's
 * end (`pagesReach`). Files open as tabs the same way, except where the page
 * takes them itself: a site, and away from a lone side's ends, a chat's
 * composer or a folder in Files (`takesFilesItself`); a new tab up nobody
 * has written in turns into them, except over its composer, which attaches
 * them (`attachesToNewTab`). A lone side's ends show faintly from the start
 * of a drag that could make one a side (`splitBands`). Another group's row
 * lands as the tab it gives up would (`tabOfHeldGroup`).
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
  // Each side's page as much of it as the row shows, scrolled sideways.
  const pages = () => {
    const shown = rectOf(scroller());
    return layout.sides.flatMap((_, side) => {
      const rect = rectOf(pageOf(side));
      const cut = rect && shown ? clipped(rect, shown) : undefined;
      return cut ? [cut] : [];
    });
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
  useDropTarget(
    isOn
      ? {
          hints: ({ held, input }) => {
            if (
              (held.kind === "group" &&
                (held.group === group || input === "remote")) ||
              (held.kind === "files" && takesFilesWhole(0))
            ) {
              return [];
            }
            return splitBands({
              held: heldInGroup(held, group, layout),
              sides: pages(),
            });
          },
          landingAt: (reached, { held, input }) => {
            const sides = pages();
            const point = onPages(reached, sides);
            const at = sides.findIndex((rect) => holds(rect, point));
            const up = upOf(at);
            // Another group's row lands as its tab would (`tabOfHeldGroup`);
            // the group up has nowhere here to go, and another window's
            // group lands only in this window's list.
            if (
              held.kind === "group" &&
              (held.group === group || input === "remote")
            ) {
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
            const zone = sideZoneAt({
              held: heldInGroup(held, group, layout),
              point,
              sides,
            });
            if (
              held.kind === "files" &&
              zone?.kind !== "split" &&
              takesFilesItself(pageOf(at), point)
            ) {
              return "native";
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
