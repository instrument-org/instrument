import { clamp } from "radashi";

/**
 * The pure measures every drag in the window shares: when a press becomes a
 * drag, where a side's page takes what is held, how fast a list scrolls
 * under a pointer near its edge, and when the pointer has left the window.
 */

/** How far a press moves before it is a drag, for everything that can be held. */
export const START_PX = 8;

/** Where along the tab files would open as the pointer holds it: its mark under the pointer. */
export const FILE_GRAB_PX = 18;

/** How far past the window's edge the pointer goes before it has left the window. */
const OFF_WINDOW_PX = 16;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** Whether a point is past a window of a size, with room at its edges. */
export function isOffWindow(
  point: Point,
  size: { height: number; width: number },
  past = OFF_WINDOW_PX,
) {
  return (
    point.x < -past ||
    point.y < -past ||
    point.x >= size.width + past ||
    point.y >= size.height + past
  );
}

/** Whether a rect has a point in it. */
export function holds(rect: Rect, { x, y }: Point) {
  return (
    x >= rect.left &&
    x < rect.left + rect.width &&
    y >= rect.top &&
    y < rect.top + rect.height
  );
}

/**
 * How near the window's edge a group's outer page may stand for its end to
 * reach on to that edge: the margin around the window's cards, which is no
 * place of its own.
 */
const EDGE_GAP_PX = 24;

/**
 * Where a group's pages, left first, take what is held: the pages, and past
 * an outer page's end standing near the window's edge, on to that edge and
 * past it as far as the pointer is still in the window, so the margin there
 * is part of the page's end rather than a gap where nothing lands.
 */
export function pagesReach(
  pages: readonly Rect[],
  windowWidth: number,
): Rect | undefined {
  const [first] = pages;
  const last = pages.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const top = Math.min(...pages.map((rect) => rect.top));
  const bottom = Math.max(...pages.map((rect) => rect.top + rect.height));
  const end = last.left + last.width;
  const left = first.left <= EDGE_GAP_PX ? -OFF_WINDOW_PX : first.left;
  const right =
    windowWidth - end <= EDGE_GAP_PX ? windowWidth + OFF_WINDOW_PX : end;
  return { height: bottom - top, left, top, width: right - left };
}

/** A point in a group's reach (`pagesReach`) as the point on its pages it stands for: one past an outer end, at that end. */
export function onPages(point: Point, pages: readonly Rect[]): Point {
  const [first] = pages;
  const last = pages.at(-1);
  if (!first || !last) {
    return point;
  }
  return {
    x: clamp(point.x, first.left, last.left + last.width - 1),
    y: point.y,
  };
}

/** How far a split target stands in from its end of a lone side's page. */
const TARGET_INSET_PX = 16;

/**
 * How near the pointer comes to a split target before the target leans
 * toward it and what is held is drawn toward the target (`pullOf`).
 */
const MAGNET_PX = 140;

/**
 * How near the pointer comes to a split target before the target takes what
 * is held: short of touching it, so the target pulls the last of the way.
 */
const CAPTURE_PX = 36;

/**
 * How near a lone side's end the pointer comes before that end takes what
 * is held at any height, so a tab flung to the window's edge still splits.
 */
const END_PX = TARGET_INSET_PX + 8;

/**
 * Where something held can make a lone side's end a side of its own: the
 * page, which the target is drawn in, and the end (0 the left).
 */
export interface SplitTarget {
  page: Rect;
  side: 0 | 1;
}

/**
 * A split target as drawn at rest: a card short of the page's height, in
 * from its end, centered down it. Narrower than the half it makes and
 * shorter than the page, so it reads as a place to aim for.
 */
export function splitTargetRect({ page, side }: SplitTarget): Rect {
  const width = Math.min(clamp(page.width * 0.18, 112, 220), page.width / 3);
  const height = Math.min(
    clamp(page.height * 0.5, 160, 360),
    page.height - TARGET_INSET_PX * 2,
  );
  return {
    height,
    left:
      side === 0
        ? page.left + TARGET_INSET_PX
        : page.left + page.width - TARGET_INSET_PX - width,
    top: page.top + (page.height - height) / 2,
    width,
  };
}

/** How far a point is from a rect, nothing inside it. */
function distanceTo(rect: Rect, { x, y }: Point) {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * How strongly a split target draws what is held toward it, from 0 at the
 * edge of its pull (`MAGNET_PX` away) to 1 where it takes it (`CAPTURE_PX`).
 */
export function pullOf(target: SplitTarget, point: Point) {
  const distance = distanceTo(splitTargetRect(target), point);
  return clamp((MAGNET_PX - distance) / (MAGNET_PX - CAPTURE_PX), 0, 1);
}

/** What is held, in terms of the group the sides are: the side it stands on there, if any, and whether it is that side's only tab. */
export interface HeldInGroup {
  /** The side of this group it stands on now. */
  side?: 0 | 1;
  /** Whether it is the only tab of the side it stands on. */
  isAlone?: boolean;
}

/** Whether what is held may make a lone side's end a side of its own: anything but that side's only tab. */
function maySplit(held: HeldInGroup) {
  return !(held.side === 0 && held.isAlone === true);
}

/**
 * The targets at a lone side's ends where what is held would make a side
 * of its own, left first: none over two sides, or for a side's only tab.
 * What a drag shows from its start, so the ends are found before the
 * pointer reaches them.
 */
export function splitTargetsOf({
  held,
  sides,
}: {
  held: HeldInGroup;
  sides: readonly Rect[];
}): SplitTarget[] {
  const [page] = sides;
  if (!page || sides.length !== 1 || !maySplit(held)) {
    return [];
  }
  return [
    { page, side: 0 },
    { page, side: 1 },
  ];
}

/** The half of a lone side's page a side made at an end would take. */
function halfOf(page: Rect, side: 0 | 1): Rect {
  const half = page.width / 2;
  return side === 0
    ? { ...page, width: half }
    : { ...page, left: page.left + half, width: half };
}

/**
 * What a side's page does with something held over it at a point: it joins
 * a side as its last tab, the side lit whole; or it makes a side of its own
 * of one end of a group of one side, that half lit. A lone side's end takes
 * what is held once the pointer is within `CAPTURE_PX` of its target, or
 * at the page's very end, and keeps it while the pointer stays in the half
 * the new side takes (`lit`), so a hand wandering over the side sliding in
 * never loses it. None where it would change nothing, as a tab over its own
 * side's page, or where a side may not be made, as from a side's only tab.
 */
export type SideZone =
  | { kind: "join"; lit: Rect; side: 0 | 1 }
  | { kind: "split"; lit: Rect; side: 0 | 1 };

export function sideZoneAt({
  held,
  lit,
  point,
  sides,
}: {
  held: HeldInGroup;
  /** The end a split already lit, which keeps it over its whole half. */
  lit?: 0 | 1;
  point: Point;
  /** Each side's page, left first, in the window's px. */
  sides: readonly Rect[];
}): SideZone | undefined {
  const at = sides.findIndex((rect) => holds(rect, point));
  const rect = sides[at];
  if (!rect) {
    return undefined;
  }
  const side: 0 | 1 = at === 1 ? 1 : 0;
  if (sides.length === 2) {
    return held.side !== side ? { kind: "join", lit: rect, side } : undefined;
  }
  const targets = splitTargetsOf({ held, sides });
  if (
    lit !== undefined &&
    targets.length > 0 &&
    holds(halfOf(rect, lit), point)
  ) {
    return { kind: "split", lit: halfOf(rect, lit), side: lit };
  }
  for (const target of targets) {
    const atEnd =
      target.side === 0
        ? point.x < rect.left + END_PX
        : point.x >= rect.left + rect.width - END_PX;
    if (atEnd || distanceTo(splitTargetRect(target), point) <= CAPTURE_PX) {
      return {
        kind: "split",
        lit: halfOf(rect, target.side),
        side: target.side,
      };
    }
  }
  return held.side === undefined
    ? { kind: "join", lit: rect, side: 0 }
    : undefined;
}

/** How far into a list from its edge the pointer starts it scrolling: a quarter of it, at most this. */
const SCROLL_ZONE_MAX_PX = 180;
/** How fast a list scrolls at most, in px a second. */
const SCROLL_TOP_SPEED = 900;
/** How long a pointer near the edge takes to bring the scroll up to speed. */
const SCROLL_EASE_IN_MS = 400;

/**
 * How fast a list scrolls with something held near one of its ends, in px a
 * second along it, negative toward its start: nothing outside a zone a
 * quarter of its length deep (at most 180px), full speed from halfway into
 * that zone to the edge and past it, and eased in over the first 400ms the
 * pointer spends there, so passing over the edge does not throw the list.
 */
export function scrollSpeed({
  at,
  end,
  heldFor,
  start,
}: {
  /** Where the pointer is along the list. */
  at: number;
  /** The list's far edge. */
  end: number;
  /** How long the pointer has been in the zone it is in. */
  heldFor: number;
  /** The list's near edge. */
  start: number;
}) {
  const length = end - start;
  if (length <= 0) {
    return 0;
  }
  const zone = Math.min(length / 4, SCROLL_ZONE_MAX_PX);
  const fromStart = at - start;
  const fromEnd = end - at;
  let direction: -1 | 0 | 1 = 0;
  let depth = 0;
  if (fromStart < zone && fromStart <= fromEnd) {
    direction = -1;
    depth = zone - fromStart;
  } else if (fromEnd < zone) {
    direction = 1;
    depth = zone - fromEnd;
  }
  if (direction === 0) {
    return 0;
  }
  const strength = Math.min(depth / (zone / 2), 1);
  const ease = Math.min(Math.max(heldFor, 0) / SCROLL_EASE_IN_MS, 1) ** 2;
  return direction * SCROLL_TOP_SPEED * strength * ease;
}
