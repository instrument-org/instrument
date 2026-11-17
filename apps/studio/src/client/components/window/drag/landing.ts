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

/**
 * How far in from a group's outer edge the pointer arms a split for
 * content, or joins the side at that edge of a group of two: the outer edge
 * alone, so whatever the page takes itself (a folder in Files, a message
 * box, a site) keeps the rest of it.
 */
export const EDGE_PX = 24;

/** How far in from that edge a split once armed holds, so a hand resting on the edge does not flicker it. */
const EDGE_KEEP_PX = 40;

/**
 * How far in from a group's outer edge a piece of the window (a tab, a
 * bookmark, a whole group) arms a split: no page's middle takes one, so the
 * deeper edge takes nothing from the page.
 */
export const PIECE_EDGE_PX = 96;

/** How far in from that edge a piece's split once armed holds, in the same proportion to it as `EDGE_KEEP_PX` to `EDGE_PX`. */
const PIECE_EDGE_KEEP_PX = 160;

/** How far in from an outer edge the line down it stands, how far short of the page's ends, and how wide. */
const EDGE_LINE_INSET_PX = 3;
const EDGE_LINE_END_PX = 12;
const EDGE_LINE_WIDTH_PX = 3;

/**
 * What is held, in terms of the group the sides are: what kind of thing it
 * is, the side it stands on there, if any, and whether it is that side's
 * only tab. Content is files, a link or a place, which open as tabs; a tab
 * (a bookmark is held as a tab from elsewhere) and a whole group are pieces
 * of the window, which land only in a strip or at an edge.
 */
export interface HeldInGroup {
  kind: "content" | "group" | "tab";
  /** The side of this group it stands on now. */
  side?: 0 | 1;
  /** Whether it is the only tab of the side it stands on. */
  isAlone?: boolean;
}

/** The half of a lone side's page a side made at an end would take. */
function halfOf(page: Rect, side: 0 | 1): Rect {
  const half = page.width / 2;
  return side === 0
    ? { ...page, width: half }
    : { ...page, left: page.left + half, width: half };
}

/** The line down a page's edge at one end. */
function edgeLineOf(page: Rect, side: 0 | 1): Rect {
  return {
    height: page.height - EDGE_LINE_END_PX * 2,
    left:
      side === 0
        ? page.left + EDGE_LINE_INSET_PX
        : page.left + page.width - EDGE_LINE_INSET_PX - EDGE_LINE_WIDTH_PX,
    top: page.top + EDGE_LINE_END_PX,
    width: EDGE_LINE_WIDTH_PX,
  };
}

/**
 * Which end of a group's pages a point on them is at the outer edge of, for
 * what is held: `EDGE_PX` in for content and `PIECE_EDGE_PX` for a piece of
 * the window, each held farther in at the end `armed`.
 */
export function edgeAt({
  armed,
  held,
  point,
  sides,
}: {
  armed?: 0 | 1 | undefined;
  held: HeldInGroup;
  point: Point;
  sides: readonly Rect[];
}): 0 | 1 | undefined {
  const first = sides[0];
  const last = sides.at(-1);
  if (!first || !last || !sides.some((rect) => holds(rect, point))) {
    return undefined;
  }
  const isPiece = held.kind !== "content";
  const reach = (end: 0 | 1) =>
    armed === end
      ? isPiece
        ? PIECE_EDGE_KEEP_PX
        : EDGE_KEEP_PX
      : isPiece
        ? PIECE_EDGE_PX
        : EDGE_PX;
  return point.x < first.left + reach(0)
    ? 0
    : point.x >= last.left + last.width - reach(1)
      ? 1
      : undefined;
}

/**
 * What a side's page does with something held over it at a point: make a
 * side of its own of one half of a group of one side (`split`), that half
 * lit; or join a side, the side lit (`join`). `edge` is the line down the
 * group's outer edge, where the pointer is at it.
 *
 * - At a group's outer edge (`edgeAt`, and the margin past it, which
 *   `onPages` brings onto the page), a lone side splits at that end, and of
 *   two sides the side at that end takes it. Nothing for a side's only tab
 *   splitting its own side, for a tab already on the side at that edge, for
 *   a whole group over two sides, or at the end `waits`.
 * - Anywhere else on the pages, content joins the side under the pointer,
 *   and a tab or a whole group lands nowhere, since a piece of the window is
 *   never something a page takes.
 */
export type SideZone =
  | {
      edge?: Rect;
      /** Joining the group's only side, as a new tab of it. */
      isLone?: true;
      kind: "join";
      lit: Rect;
      side: 0 | 1;
    }
  | { edge?: Rect; kind: "split"; lit: Rect; side: 0 | 1 };

export function sideZoneAt({
  armed,
  held,
  point,
  sides,
  waits,
}: {
  /** The edge the last measure was at, which holds a little farther in. */
  armed?: 0 | 1 | undefined;
  held: HeldInGroup;
  point: Point;
  /** Each side's page, left first, in the window's px. */
  sides: readonly Rect[];
  /** An end whose edge arms nothing yet: a whole group's that came free of the sidebar inside it, until the pointer has been out of it. */
  waits?: 0 | 1 | undefined;
}): SideZone | undefined {
  const at = sides.findIndex((rect) => holds(rect, point));
  const rect = sides[at];
  if (!rect) {
    return undefined;
  }
  const reached = edgeAt({ armed, held, point, sides });
  const edge = reached === waits ? undefined : reached;
  if (sides.length === 1) {
    if (edge !== undefined) {
      // A side's only tab makes no side of its own side.
      return held.kind === "tab" && held.side === 0 && held.isAlone === true
        ? undefined
        : {
            edge: edgeLineOf(rect, edge),
            kind: "split",
            lit: halfOf(rect, edge),
            side: edge,
          };
    }
    return held.kind === "content"
      ? { isLone: true, kind: "join", lit: rect, side: 0 }
      : undefined;
  }
  if (held.kind === "group") {
    return undefined;
  }
  if (edge !== undefined) {
    const page = sides[edge];
    return page && !(held.kind === "tab" && held.side === edge)
      ? { edge: edgeLineOf(page, edge), kind: "join", lit: page, side: edge }
      : undefined;
  }
  return held.kind === "content"
    ? { kind: "join", lit: rect, side: at === 1 ? 1 : 0 }
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

/**
 * How long the pointer rests on the middle of a tab or a row before what is
 * held goes into it, rather than into the gap beside it.
 */
export const REST_MS = 220;

/** Half of the middle a rest starts in, as a share of the tab or row: its middle 44%. */
const REST_IN_SHARE = 0.22;

/** Half of the middle a tab or row keeps what is held in once it has it, as a share of it: its middle 72%. */
const STAY_IN_SHARE = 0.36;

/** How far past a tab's or row's middle the pointer goes before the line moves to its other side. */
const GIVE_PX = 6;

/** A tab of a strip or a row of a list, along the strip or list, and whether what is held may go into it. */
export interface Span {
  isTakeable: boolean;
  size: number;
  start: number;
}

/** Where what is held lands among spans: the gap before one (`spans.length` past the last), or into one. */
export interface SteadyPick {
  index: number;
  kind: "gap" | "into";
}

/** What a steady landing keeps from one measure to the next. */
export interface Steady {
  /** The gap the line was last at. */
  gap?: number | undefined;
  /** The span the pointer rests on the middle of, and since when. */
  resting?: { index: number; since: number } | undefined;
  /** The span that has taken what is held, until the pointer leaves its middle. */
  taken?: number | undefined;
}

/**
 * The steady landing among the tabs of a strip or the rows of a list, which
 * stand still under it: the line goes to the gap nearest the pointer, and
 * moves to the next one only once the pointer is `GIVE_PX` past the middle
 * of the span between them. Resting `REST_MS` on a takeable span's middle
 * 44% goes into that span, which keeps what is held while the pointer stays
 * in its middle 72%. `wakeAt` is when a rest under way would be done, so a
 * drag that only hears of the pointer as it moves can measure again then.
 */
export function steadyPick({
  at,
  now,
  spans,
  was = {},
}: {
  /** The pointer along the strip or list. */
  at: number;
  now: number;
  spans: readonly Span[];
  was?: Steady;
}): { next: Steady; pick: SteadyPick; wakeAt?: number } {
  const middle = (span: Span) => span.start + span.size / 2;
  const taken = was.taken === undefined ? undefined : spans[was.taken];
  if (
    was.taken !== undefined &&
    taken?.isTakeable === true &&
    Math.abs(at - middle(taken)) <= taken.size * STAY_IN_SHARE
  ) {
    return {
      next: { gap: was.gap, taken: was.taken },
      pick: { index: was.taken, kind: "into" },
    };
  }
  const over = spans.findIndex(
    (span) =>
      span.isTakeable &&
      Math.abs(at - middle(span)) <= span.size * REST_IN_SHARE,
  );
  const resting =
    over === -1
      ? undefined
      : was.resting?.index === over
        ? was.resting
        : { index: over, since: now };
  if (resting && now - resting.since >= REST_MS) {
    return {
      next: { gap: was.gap, taken: resting.index },
      pick: { index: resting.index, kind: "into" },
    };
  }
  let gap = 0;
  spans.forEach((span, index) => {
    const give = was.gap !== undefined && index < was.gap ? -GIVE_PX : GIVE_PX;
    if (at > middle(span) + give) {
      gap = index + 1;
    }
  });
  return {
    next: { gap, resting },
    pick: { index: gap, kind: "gap" },
    ...(resting ? { wakeAt: resting.since + REST_MS } : {}),
  };
}
