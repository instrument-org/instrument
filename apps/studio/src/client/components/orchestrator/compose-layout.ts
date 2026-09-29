import { type ComposeEntry } from "@/client/atoms/orchestrator";

/** A docked draft window's width, a thread's small view's, and a bar's, in layout px, which is how the foot is laid out. */
export const COMPOSE_WIDTH = 600;
export const THREAD_WINDOW_WIDTH = 420;
export const COMPOSE_BAR_WIDTH = 300;

/** How much wider a thread's small view stands for the rail of what the chat holds, in layout px (the rail's `w-30`). */
export const THREAD_RAIL_WIDTH = 120;

/** The rail folded to a column of marks, `w-14`. */
const THREAD_RAIL_COMPACT_WIDTH = 56;

/** The least a grown thread window's view keeps beside its conversation, the pane's own floor, before the rail folds to give it room. */
const GROWN_VIEW_MIN = 300;

/**
 * The window layer a draft's page guest is shown on: above the draft windows
 * (`z-40`) so the page is not under its own opaque window, and under every
 * menu and popover (`z-50`), which stay over the page the way they do over
 * the pane's.
 */
export const COMPOSE_GUEST_LAYER = 41;

/** The room between two windows along the foot, and between the leftmost and the row's left end, in layout px. */
export const COMPOSE_GAP = 12;

/**
 * The room between the rightmost window and the window's right edge, in
 * screen px rather than layout px: wider than the gap between windows, so a
 * window standing on the foot clears the curve of the window's rounded
 * bottom-right corner and the edge the system draws along it, which do not
 * grow with the UI's zoom.
 */
export const COMPOSE_EDGE_GAP = 20;

/** How a window or a bar comes, goes, and moves along the foot: quick, and easing to rest with no overshoot. */
export const COMPOSE_MOTION = {
  duration: 0.2,
  ease: [0.2, 0, 0, 1],
  type: "tween",
} as const;

/**
 * A grown window's box, stated rather than left to the classes: a docked
 * window's width and height are motion values, and a style that merely stops
 * naming them can leave the last ones standing. Its right edge is not here:
 * that is animated, to GROWN_RIGHT, and a style naming it as well would fight
 * the animation.
 */
export const GROWN = {
  bottom: 12,
  height: "auto",
  left: 12,
  top: 12,
  width: "auto",
} as const;

/** A grown window's right edge, in layout px, as its other edges stand. */
export const GROWN_RIGHT = 12;

/**
 * A window with its place along the foot: how far its right edge stands from
 * the row's, its width when the row is narrower than its own, and whether a
 * thread window's rail folds to its marks to fit.
 */
export type PlacedCompose = ComposeEntry & {
  isRailCompact?: boolean;
  right: number;
  width?: number;
};

/**
 * Lays the windows along the foot the way a mail client does: the newest
 * at the right edge, each older one beside the last, and the ones there is
 * no room for left out from the left, so the row never wraps or squeezes. A
 * window grown to fill the row stands alone among the windows; the bars
 * along the foot stay in their places under it. A thread's small view is
 * laid the same way as a draft's window, at its own width.
 */
export function layoutCompose(
  entries: ComposeEntry[],
  width: number,
  /** Whether a thread's small view carries its rail, which it does while the chat holds anything. */
  hasRail: (entry: ComposeEntry) => boolean = () => false,
  /** The UI's zoom, which the row is laid out in and the window's edge is not. */
  zoom = 1,
): PlacedCompose[] {
  const isOneExpanded = entries.some((entry) => entry.placement === "expanded");
  const placed: PlacedCompose[] = [];
  let right = COMPOSE_EDGE_GAP / zoom;
  for (const [index, entry] of entries.toReversed().entries()) {
    if (entry.placement === "expanded") {
      // Grown over the row: the conversation, the view beside it and the
      // rail, which folds once the three no longer fit at their own widths.
      const isRailCompact =
        hasRail(entry) &&
        width - 2 * GROWN_RIGHT <
          THREAD_WINDOW_WIDTH + GROWN_VIEW_MIN + THREAD_RAIL_WIDTH;
      placed.push({
        ...entry,
        right: 0,
        ...(isRailCompact ? { isRailCompact } : {}),
      });
      continue;
    }
    if (isOneExpanded && entry.placement === "docked") {
      continue;
    }
    // A bar is a bar's width whatever the chat holds: the rail is drawn
    // only by a window.
    const railed = entry.placement !== "bar" && hasRail(entry);
    const own = widthOf(entry) + (railed ? THREAD_RAIL_WIDTH : 0);
    const room = width - right - COMPOSE_GAP;
    // A window whose rail's pictures do not fit stands with the rail folded
    // to its marks, at the narrower width that gives it.
    const folded = widthOf(entry) + THREAD_RAIL_COMPACT_WIDTH;
    if (railed && own > room && folded <= room) {
      placed.push({ ...entry, isRailCompact: true, right, width: folded });
      right += folded + COMPOSE_GAP;
      continue;
    }
    // The first that does not fit ends the row, and everything older with
    // it: a bar squeezed in past a window would put the windows out of order.
    if (own > room) {
      // The newest always stands, narrowed to the row: a window that is not
      // drawn is a New that appears to do nothing.
      if (index === 0 && room > 0) {
        placed.push({
          ...entry,
          right,
          width: room,
          ...(railed ? { isRailCompact: true } : {}),
        });
      }
      break;
    }
    placed.push({ ...entry, right });
    right += own + COMPOSE_GAP;
  }
  return placed;
}

/** How wide a window stands along the foot: a bar's width put down, and otherwise its kind's. */
function widthOf(entry: ComposeEntry): number {
  if (entry.placement === "bar") {
    return COMPOSE_BAR_WIDTH;
  }
  return entry.kind === "thread" ? THREAD_WINDOW_WIDTH : COMPOSE_WIDTH;
}
