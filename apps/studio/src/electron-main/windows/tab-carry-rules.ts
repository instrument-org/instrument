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
 * own row, free of every strip, or held in another window's strip. Each effect
 * belongs to going in or out of a phase.
 */
export type CarryPhase<W> =
  | {
      /** Where the tab stands in the strip, as the window showing it says. */
      landsAt?: number;
      kind: "docked";
      window: W;
    }
  | { kind: "free" }
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
  return { kind: "free" };
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
 * What leaves when the tab is let go. The tab, by default: it opens in the spare
 * window and the window it came from stays as it is, along with every page in it.
 * The window that held the press leaves instead where the tab has a page someone
 * has used, since that page cannot change renderers and keep what it holds: the
 * spare window takes the other tabs in its place. A window that cannot be placed,
 * or stands full screen, stays. A window's only tab has its window to itself.
 */
export function whatGoes({
  canPlace,
  isFullScreen,
  isOnlyTab,
  isTabPageUsed,
}: {
  canPlace: boolean;
  isFullScreen: boolean;
  isOnlyTab: boolean;
  isTabPageUsed: boolean;
}): "tab" | "window" {
  if (isOnlyTab) {
    return "window";
  }
  return canPlace && !isFullScreen && isTabPageUsed ? "window" : "tab";
}

/**
 * Who reopens when a tab is let go over another window's strip. The tab goes to
 * that window, which stays as it is, unless the tab has a used page: then the
 * pressed window stays and takes on that window's tabs. With used pages on both
 * sides the tab in hand wins.
 */
export function landsBy({
  goes,
  isTabPageUsed,
}: {
  goes: "tab" | "window";
  isTabPageUsed: boolean;
}): "joining" | "takingStrip" {
  return goes === "tab" || !isTabPageUsed ? "joining" : "takingStrip";
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
