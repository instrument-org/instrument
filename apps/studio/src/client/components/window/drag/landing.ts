import { clamp } from "radashi";

/**
 * The pure measures every drag in the window shares: when a press becomes a
 * drag, where a side's page takes what is held, how long a page waits before
 * it does, how fast a list scrolls under a pointer near its edge, and when
 * the pointer has left the window.
 */

/** How far a press moves before it is a drag, for everything that can be held. */
export const START_PX = 8;

/**
 * How long what is held rests over a side's page before the page takes it,
 * so a tab passing over a page on its way to the sidebar or another window
 * does not split the group by accident.
 */
export const DWELL_MS = 400;

/** Where along the tab files would open as the pointer holds it: its mark under the pointer. */
export const FILE_GRAB_PX = 18;

/** How far past the window's edge the pointer goes before it has left the window. */
export const OFF_WINDOW_PX = 16;

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
 * How wide the band at each end of a lone side's page is, where something
 * held makes that end a side of its own: a fifth of the page, never under
 * 120 or over 360, and never more than a third of a narrow page.
 */
export function splitBandWidth(width: number) {
  return Math.min(clamp(width * 0.2, 120, 360), width / 3);
}

/**
 * What a side's page does with something held over it at a point: it joins
 * a side as its last tab, the side lit whole; or it makes a side of its own
 * of one end of a group of one side, that half lit. None where it would
 * change nothing, as a tab over its own side's page, or where a side may not
 * be made, as from a side's only tab.
 */
export type SideZone =
  | { kind: "join"; lit: Rect; side: 0 | 1 }
  | { kind: "split"; lit: Rect; side: 0 | 1 };

export function sideZoneAt({
  held,
  point,
  sides,
}: {
  /** What is held, in terms of the group the sides are: the side it stands on there, if any, and whether it is that side's only tab. */
  held: {
    /** Whether it can join a side's tabs where it is let go over the page (a tab can; files go to what the page shows). */
    joins: boolean;
    /** The side of this group it stands on now. */
    side?: 0 | 1;
    /** Whether it is the only tab of the side it stands on. */
    isAlone?: boolean;
  };
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
    return held.joins && held.side !== side
      ? { kind: "join", lit: rect, side }
      : undefined;
  }
  const band = splitBandWidth(rect.width);
  const half = rect.width / 2;
  const canSplit = !(held.side === 0 && held.isAlone === true);
  if (canSplit && point.x < rect.left + band) {
    return { kind: "split", lit: { ...rect, width: half }, side: 0 };
  }
  if (canSplit && point.x >= rect.left + rect.width - band) {
    return {
      kind: "split",
      lit: { ...rect, left: rect.left + half, width: half },
      side: 1,
    };
  }
  return held.joins && held.side === undefined
    ? { kind: "join", lit: rect, side: 0 }
    : undefined;
}

/** A place something held has rested since a moment, by a key saying which place. */
export interface Dwell {
  key: string;
  since: number;
}

/** The rest at a place, started over when the place changes, and gone off every place. */
export function restAt(
  previous: Dwell | undefined,
  key: string | undefined,
  now: number,
): Dwell | undefined {
  if (key === undefined) {
    return undefined;
  }
  return previous?.key === key ? previous : { key, since: now };
}

/** Whether a rest has gone on long enough for the place to take what is held. */
export function hasRested(
  dwell: Dwell | undefined,
  now: number,
  ms = DWELL_MS,
) {
  return dwell !== undefined && now - dwell.since >= ms;
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
