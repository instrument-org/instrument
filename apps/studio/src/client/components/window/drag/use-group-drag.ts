import { type WindowTab } from "@/client/atoms/window";
import { useAtomValue } from "jotai";
import { clamp } from "radashi";

import { stripKeyOf } from "../pane-tabs";
import { stripIndexAt } from "../tab-carry-view";
import { type GroupLayout, isHomeTab, sideIndexOf } from "../tab-model";
import { useWindowTabs } from "../window-tabs";
import { pageLandingOf, type SideShows, type UnderPoint } from "./accepts";
import { heldKeysOf, heldTabsOf } from "./held-tabs";
import {
  edgeAt,
  type HeldInGroup,
  holds,
  onPages,
  pagesReach,
  type Point,
  type Rect,
  sideZoneAt,
} from "./landing";
import {
  currentDrag,
  dragAtom,
  dragPoint,
  pressToHold,
  steadyAt,
  useDropTarget,
} from "./session";
import { type Held, isBookmark, type Landing } from "./types";
import { pullOf } from "./use-sidebar-drag";

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
 * A side's strip as a drag draws it: its own tab held along it standing
 * where it would land, the first of it at the pointer and up, the rest
 * making room; or its own tab held anywhere else given up, its neighbors
 * closing over its place. Nothing from elsewhere moves it
 * (`steadyLandingAt`).
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
  tabs: WindowTab[];
} {
  const drag = useAtomValue(dragAtom);
  const { allTabs } = useWindowTabs();
  const held = drag?.held;
  if (held?.kind !== "tab" || held.group !== group || held.side !== side) {
    return { tabs };
  }
  const landing = drag?.landing;
  if (
    landing?.kind !== "strip" ||
    landing.group !== group ||
    landing.side !== side
  ) {
    return { carriedKey: held.key, tabs };
  }
  const heldTabs = heldTabsOf(held, allTabs);
  const [first] = heldTabs;
  if (!drag || !first) {
    return { tabs };
  }
  const keys = heldKeysOf(held);
  const others = tabs.filter((tab) => !keys.includes(stripKeyOf(tab)));
  return {
    chosenId: first.id,
    heldAt: { grabX: drag.grab.x, key: stripKeyOf(first) },
    tabs: others.toSpliced(landing.index, 0, ...heldTabs),
  };
}

/** How far outside a strip's first or last tab the line before or after it stands. */
const END_LINE_PX = 2;

/** How far in from the top and bottom of a strip's tabs the line between them stops, as the bookmarks bar's does. */
const LINE_INSET_PX = 6;

/**
 * Where something from elsewhere lands in a strip that stands still under
 * it (`steadyAt`), measured from the pointer: the gap nearest it, with a
 * line there, or for a link or files, the tab whose middle the pointer
 * rests on, which opens it in place of what it shows.
 */
function steadyLandingAt({
  group,
  held,
  point,
  root,
  side,
  tabs,
}: {
  group: string;
  held: Held;
  point: Point;
  root: HTMLElement;
  side: 0 | 1;
  tabs: readonly WindowTab[];
}): Landing | undefined {
  const list = root.querySelector<HTMLElement>("[role=tablist]");
  if (!list) {
    return undefined;
  }
  const keyed = new Map(tabs.map((tab) => [stripKeyOf(tab), tab]));
  const drawn = [
    ...list.querySelectorAll<HTMLElement>("[data-tab-key]"),
  ].flatMap((element) => {
    const tab = keyed.get(element.dataset.tabKey ?? "");
    return tab ? [{ rect: element.getBoundingClientRect(), tab }] : [];
  });
  const mayOpenIn = held.kind === "link" || held.kind === "files";
  const pick = steadyAt(
    `strip:${group}:${String(side)}`,
    point.x,
    drawn.map(({ rect }) => ({
      isTakeable: mayOpenIn,
      size: rect.width,
      start: rect.left,
    })),
  );
  const into = pick.kind === "into" ? drawn[pick.index] : undefined;
  if (into) {
    const { height, left, top, width } = into.rect;
    return {
      group,
      kind: "replace",
      lit: { height, left, top, width },
      side,
      tab: into.tab.id,
    };
  }
  const before = drawn[pick.index - 1];
  const after = drawn[pick.index];
  const bounds = list.getBoundingClientRect();
  const shown =
    root.querySelector("[data-strip-scroller]")?.getBoundingClientRect() ??
    bounds;
  const x = clamp(
    before && after
      ? (before.rect.right + after.rect.left) / 2
      : after
        ? after.rect.left - END_LINE_PX
        : before
          ? before.rect.right + END_LINE_PX
          : bounds.left + END_LINE_PX,
    shown.left + 1,
    shown.right - 1,
  );
  const row = (after ?? before)?.rect ?? bounds;
  return {
    group,
    index: before ? tabs.indexOf(before.tab) + 1 : 0,
    kind: "strip",
    line: {
      height: row.height - LINE_INSET_PX * 2,
      left: x - 1,
      top: row.top + LINE_INSET_PX,
      width: 2,
    },
    side,
  };
}

/**
 * A side's strip as a place to land, and just above or below it. Its own
 * tab held along it stands where its left edge is (`stripIndexAt`), its
 * neighbors making room; a tab, a whole group, files or a link from
 * elsewhere leave it standing still (`steadyLandingAt`).
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
            if (
              held.kind !== "tab" ||
              held.group !== group ||
              held.side !== side
            ) {
              return steadyLandingAt({ group, held, point, root, side, tabs });
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

/** What the held thing is to a group's sides: what kind of thing, and where it stands among them, if it is a tab of the group. */
function heldInGroup(
  held: Held,
  group: string,
  layout: GroupLayout,
): HeldInGroup {
  if (held.kind === "group") {
    return { kind: "group" };
  }
  // A bookmark opens as its tab wherever a tab from elsewhere lands.
  if (isBookmark(held)) {
    return { kind: "tab" };
  }
  if (held.kind !== "tab") {
    return { kind: "content" };
  }
  const side = held.group === group ? sideIndexOf(layout, held.id) : undefined;
  if (side === undefined) {
    return { kind: "tab" };
  }
  const alone = (layout.sides[side]?.tabs.length ?? 0) <= 1;
  return { isAlone: alone, kind: "tab", side };
}

/**
 * What a side's page has under a point that takes a drop itself
 * (`UnderPoint`): a composer's box and a folder in Files
 * (`data-file-drop-region`), a field that takes words, and anything
 * standing over the page there, as a dialog or a page in a frame of its own
 * does. Nothing else in a page takes a drop, an open file's editor
 * included, so files let go there open beside it as tabs instead of going
 * into it.
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
    return region.hasAttribute("data-folder-drop") ? "folder" : "box";
  }
  const isField =
    (under instanceof HTMLElement && under.isContentEditable) ||
    under.closest(
      "textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email]",
    ) !== null;
  return isField ? "text" : undefined;
}

/**
 * A whole group pulled free of the sidebar with the pointer already at a
 * page's outer edge, as the sidebar's reach past its own edge leaves it at
 * the left one: that end waits, arming nothing, until the pointer has been
 * out of its edge once. The pull that freed it (`pullOf`), and the end
 * still waiting.
 */
let freed: { pull: object; waits: 0 | 1 | undefined } | undefined;

/** The end of a group's pages waiting for a whole group held, with the pointer at the edge of `at` or at none. */
function waitingEnd(held: Held, at: 0 | 1 | undefined) {
  const pull = pullOf(held);
  if (!pull) {
    return undefined;
  }
  if (freed?.pull !== pull) {
    freed = { pull, waits: at };
  } else if (freed.waits !== at) {
    freed.waits = undefined;
  }
  return freed.waits;
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
 * the group's outer edge, and only that, makes a side of a lone side's end,
 * or of two sides takes it into the side there (`sideZoneAt`), its line
 * drawn down the edge once the pointer is there and nothing shown before;
 * content goes to whatever in the page takes it (a composer, a field, a web
 * page, a folder in Files); a new tab nobody has written in turns into
 * files or a link; and content anywhere else joins the side under the
 * pointer. A tab, a bookmark or a whole group from this window lands
 * nowhere on a page but its edge, which reaches deeper for them
 * (`edgeAt`), a place nowhere on a page at all, and a whole group that
 * came free of the sidebar inside an edge waits until the pointer has been
 * out of it (`waitingEnd`). The margin between an outer page and the
 * window's edge counts as that page's edge (`pagesReach`). Nothing in the
 * group is drawn again while something is held over it, so the pages stay
 * put under the pointer.
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
  useDropTarget(
    isOn
      ? {
          landingAt: (reached, { held, input }) => {
            // A group lands on another group's pages, and only from this
            // window.
            if (
              held.kind === "group" &&
              (held.group === group || input === "remote")
            ) {
              return undefined;
            }
            const sides = pages();
            const point = onPages(reached, sides);
            const at = sides.findIndex((rect) => holds(rect, point));
            const up = upOf(at);
            const was = currentDrag()?.landing;
            const heldIn = heldInGroup(held, group, layout);
            const zone = sideZoneAt({
              armed:
                was?.kind === "side" && was.group === group && was.edge
                  ? was.side
                  : undefined,
              held: heldIn,
              point,
              sides,
              waits: waitingEnd(held, edgeAt({ held: heldIn, point, sides })),
            });
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
          // Read once a frame wherever the pointer is, so a whole group
          // waiting at an edge it came free inside sees the pointer leave
          // it over the strip or past the pages too.
          rect: ({ held }) => {
            const sides = pages();
            const reach = pagesReach(sides, window.innerWidth);
            if (held.kind === "group") {
              waitingEnd(
                held,
                reach && holds(reach, dragPoint)
                  ? edgeAt({
                      held: { kind: "group" },
                      point: onPages(dragPoint, sides),
                      sides,
                    })
                  : undefined,
              );
            }
            return reach;
          },
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
