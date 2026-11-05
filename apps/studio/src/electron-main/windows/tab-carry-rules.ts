import { type TabCarryView, type TabId } from "@/shared/tabs";
import { z } from "zod";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  height: number;
  width: number;
}

/**
 * Where a tab being carried is, which everything it shows follows from: on its
 * own row, free of every strip with a window under the pointer, or held in
 * another window's strip. Each effect belongs to going in or out of a phase.
 */
export type CarryPhase<W> =
  | {
      /** Where the tab stands in the strip, as the window showing it says. */
      landsAt?: number;
      kind: "docked";
      window: W;
    }
  | {
      /** The carried window stands where the pointer holds it, drawn as it should be there. */
      isPlaced: boolean;
      kind: "free";
    }
  | { kind: "row" };

export function isSamePhase<W>(a: CarryPhase<W>, b: CarryPhase<W>) {
  return (
    a.kind === b.kind &&
    (a.kind !== "docked" || (b.kind === "docked" && a.window === b.window))
  );
}

/**
 * Whether a point is on a window at all, and on the band its strip draws in.
 * `reach` is how far past its top and sides and below its strip that band goes.
 */
export function placeOnWindow(
  bounds: Bounds,
  point: Point,
  bandHeight: number,
  reach = 0,
): "band" | "body" | "off" {
  if (
    point.x < bounds.x - reach ||
    point.x >= bounds.x + bounds.width + reach ||
    point.y < bounds.y - reach ||
    point.y >= bounds.y + bounds.height
  ) {
    return "off";
  }
  return point.y - bounds.y < bandHeight + reach ? "band" : "body";
}

/**
 * Where a tab off its row stands at a point, from the windows front to back: the
 * first one under the point has it. Over another window's strip it is docked
 * there, and over its own it is back on its row; anywhere else it is free, the
 * way a browser's tab is, even over another window's page.
 */
export function phaseAt<W>({
  bandHeight,
  from,
  point,
  windows,
}: {
  bandHeight: number;
  from: W;
  point: Point;
  windows: readonly {
    bounds: Bounds;
    /** How far past its strip it still counts as over it. */
    reach?: number;
    window: W;
  }[];
}): CarryPhase<W> {
  for (const { bounds, reach, window } of windows) {
    const place = placeOnWindow(bounds, point, bandHeight, reach);
    if (place === "band") {
      return window === from ? { kind: "row" } : { kind: "docked", window };
    }
    if (place === "body") {
      break;
    }
  }
  return { isPlaced: false, kind: "free" };
}

/**
 * Where a window goes so the point it was grabbed at stays under the pointer,
 * the same size as the window the tab came from and no bigger than the screen.
 */
export function boundsUnderPointer(
  point: Point,
  grab: Point,
  size: { height: number; width: number },
  workArea: { height: number; width: number },
): Bounds {
  return {
    height: Math.min(size.height, workArea.height),
    width: Math.min(size.width, workArea.width),
    x: Math.round(point.x - grab.x),
    y: Math.round(point.y - grab.y),
  };
}

/**
 * What goes with the pointer. The window that held the press, by default: its
 * renderer already has the tab as it is, page and all, so the tab is simply left
 * alone with the pointer and the spare window opens beneath on the tabs it leaves
 * behind. The tab goes instead, rebuilt in the spare window with the pressed window
 * staying where it is, only where that costs less or there is no choice.
 */
export function whatGoes({
  canPlace,
  isFullScreen,
  isOnlyTab,
  isPageUsedBehind,
  isTabPageUsed,
}: {
  canPlace: boolean;
  isFullScreen: boolean;
  isOnlyTab: boolean;
  isPageUsedBehind: boolean;
  isTabPageUsed: boolean;
}): "tab" | "window" {
  if (isOnlyTab) {
    return "window";
  }
  return !canPlace || isFullScreen || (isPageUsedBehind && !isTabPageUsed)
    ? "tab"
    : "window";
}

/**
 * Whether the spare window has its tabs as the drag starts, so that it is ready the
 * moment the tab leaves its row. A page can be in one renderer at a time and comes
 * back afresh in another, which no drag along the row should cost it, so a spare
 * window that would ask for a page waits until the tab has really left. One just
 * opened cannot wait: it reads its tabs once as it loads, and hears nothing until
 * its page is up.
 */
export function dressesAtStart({
  goes,
  hasFloats,
  isSpareUp,
  neighborPages,
  pages,
}: {
  goes: "tab" | "window";
  hasFloats: boolean;
  isSpareUp: boolean;
  neighborPages: readonly unknown[];
  pages: readonly unknown[];
}) {
  if (!isSpareUp) {
    return true;
  }
  return goes === "tab"
    ? pages.length === 0
    : !hasFloats && neighborPages.length === 0;
}

/**
 * Who reopens when a tab is let go over another window's strip. The window under
 * the pointer stays and the other reopens, unless the window held over has a used
 * page and the tab has none: then the tab goes to it. With used pages on both
 * sides the tab in hand wins.
 */
export function landsBy({
  goes,
  isTabPageUsed,
  isTargetPageUsed,
}: {
  goes: "tab" | "window";
  isTabPageUsed: boolean;
  isTargetPageUsed: boolean;
}): "joining" | "takingStrip" {
  return goes === "tab" || (isTargetPageUsed && !isTabPageUsed)
    ? "joining"
    : "takingStrip";
}

/** What a window's strip shows of the tab, as the drag stands. */
export function carryView<W>({
  carried,
  docked,
  goes,
  heldId,
  phase,
  spare,
  window,
}: {
  /** The window under the pointer as the tab is held. */
  carried: W;
  /** Where the tab is held along the strip it is over, and that strip's tabs. */
  docked: () => Omit<
    Extract<TabCarryView, { kind: "docked" }>,
    "heldId" | "kind"
  >;
  goes: "tab" | "window";
  heldId: TabId;
  phase: CarryPhase<unknown>;
  spare: null | W;
  window: W;
}): TabCarryView {
  if (phase.kind === "row") {
    return window === spare ? { kind: "beneath" } : { kind: "row" };
  }
  if (window !== carried) {
    return { kind: "row" };
  }
  if (phase.kind === "free") {
    return goes === "window" ? { heldId, kind: "free" } : { kind: "row" };
  }
  return { ...docked(), heldId, kind: "docked" };
}

const FloatsSchema = z
  .array(
    z.looseObject({
      chatId: z.string().optional(),
      draftId: z.string().optional(),
    }),
  )
  .catch([]);

/** Two windows' floats as one, a chat or a draft floating in both counted once. */
export function mergeFloats(kept: unknown, more: unknown) {
  const seen = new Set<string | undefined>();
  return [...FloatsSchema.parse(kept), ...FloatsSchema.parse(more)].filter(
    ({ chatId, draftId }) => {
      const key = draftId ?? chatId;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
  );
}
