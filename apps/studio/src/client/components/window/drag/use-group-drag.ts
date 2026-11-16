import { isPlaceDragInAir } from "@/client/lib/self-file-drag";
import { type WindowTab } from "@/client/atoms/window";
import { useAtomValue } from "jotai";

import { stripKeyOf } from "../pane-tabs";
import { stripIndexAt } from "../tab-carry-view";
import { type GroupLayout, isHomeTab, sideIndexOf } from "../tab-model";
import { useWindowTabs } from "../window-tabs";
import { pageLandingOf, type SideShows, type UnderPoint } from "./accepts";
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
import { currentDrag, dragAtom, pressToHold, useDropTarget } from "./session";
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
 * What a side's page has under a point that takes a drop itself
 * (`UnderPoint`): a composer's box and a folder in Files
 * (`data-file-drop-region`), a folder never a place of Files' sidebar
 * (`isPlaceDragInAir`), a field that takes words, and anything standing over
 * the page there, as a dialog or a page in a frame of its own does. Nothing
 * else in a page takes a drop, an open file's editor included, so files let
 * go there open beside it as tabs instead of going into it.
 */
function underPointOf(
  page: Element | null | undefined,
  point: Point,
): UnderPoint | undefined {
  const under = document.elementFromPoint(point.x, point.y);
  if (
    !page ||
    !under ||
    !page.contains(under) ||
    under.tagName === "WEBVIEW" ||
    under.tagName === "IFRAME"
  ) {
    return "over";
  }
  const region = under.closest("[data-file-drop-region]");
  if (region && page.contains(region)) {
    if (!region.hasAttribute("data-folder-drop")) {
      return "box";
    }
    return isPlaceDragInAir() ? "place" : "folder";
  }
  const isField =
    (under instanceof HTMLElement && under.isContentEditable) ||
    under.closest(
      "textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email]",
    ) !== null;
  return isField ? "text" : undefined;
}

/** What a side shows up, as a drop over its page reads it. */
function sideShows(tab: WindowTab | undefined): SideShows {
  if (tab?.kind === "page") {
    return "site";
  }
  return tab !== undefined && isHomeTab(tab) ? "newTab" : "other";
}

/**
 * A group's sides' pages as a place to land, by one rule (`pageLandingOf`):
 * with one side, a split target at each end makes that half a side of its
 * own once the pointer nears it (`sideZoneAt`); content goes to whatever in
 * the page takes it (a composer, a field, a web page, a folder in Files);
 * a new tab nobody has written in turns into files or a link; and anything
 * else joins the side under the pointer, as a tab does. The margin between
 * an outer page and the window's edge counts as that page's end
 * (`pagesReach`). The split targets show from the start of a drag that
 * could make one a side. A whole group pulled out of the sidebar makes a
 * side of all its tabs at a split target, joins the side under the pointer
 * of a group of two sides with all of them, as a tab joins it, and anywhere
 * else on the pages goes to a window of its own, where the window has
 * another group to show. Nothing in the group is drawn again while
 * something is held over it, so the pages stay put under the pointer.
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
  /** Whether a held group's tabs may make a side here: another group's, held in this window. */
  const maySplitGroup = (held: Held, input: string) =>
    held.kind !== "group" || (held.group !== group && input !== "remote");
  useDropTarget(
    isOn
      ? {
          hints: ({ held, input }) => {
            // A site hears the system's drag of content over it itself, and
            // the window never does, so over one there is no end to reach.
            if (
              !maySplitGroup(held, input) ||
              (input === "native" && sideShows(upOf(0)) === "site")
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
            return pageLandingOf({
              group,
              held,
              input,
              page: sides[at],
              shows: sideShows(up),
              tab: up?.id,
              under:
                input === "native"
                  ? underPointOf(pageOf(at), point)
                  : undefined,
              zone,
            });
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
  pressToHold(event, () => ({
    group,
    id: tab.id,
    key: stripKeyOf(tab),
    kind: "tab",
    side,
  }));
}
