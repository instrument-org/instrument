import { type ComposeEntry } from "@/client/atoms/window";

/** A docked draft window's width, a chat's small view's, and a bar's, in layout px, which is how the foot is laid out. */
export const COMPOSE_WIDTH = 600;
export const CHAT_WINDOW_WIDTH = 420;
export const COMPOSE_BAR_WIDTH = 300;

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

/** The room a grown window leaves at each side of it, in layout px, so what it stands over shows around it however wide the window grows. */
const GROWN_SIDE = 80;

/**
 * A grown window's box, stated rather than left to the classes: a docked
 * window's width and height are motion values, and a style that merely stops
 * naming them can leave the last ones standing. Centered over the whole
 * window, the bar and the rail included, by its auto side margins between a
 * left and a right of zero. Its right edge is not here: that is animated, to
 * zero, and a style naming it as well would fight the animation.
 */
export const GROWN = {
  bottom: 40,
  height: "auto",
  left: 0,
  marginInline: "auto",
  top: 40,
  width: `calc(100% - ${2 * GROWN_SIDE}px)`,
} as const;

/**
 * A window with its place along the foot: how far its right edge stands from
 * the row's, and its width when the row is narrower than its own.
 */
export type PlacedCompose = ComposeEntry & {
  right: number;
  width?: number;
};

/**
 * Lays the windows along the foot the way a mail client does: the newest
 * at the right edge, each older one beside the last, and the ones there is
 * no room for left out from the left, so the row never wraps or squeezes. A
 * grown window stands alone among the windows, over the whole window; the
 * bars along the foot stay in their places under it. A chat's small view is
 * laid the same way as a draft's window, at its own width.
 */
export function layoutCompose(
  entries: ComposeEntry[],
  width: number,
  /** The UI's zoom, which the row is laid out in and the window's edge is not. */
  zoom = 1,
): PlacedCompose[] {
  const isOneExpanded = entries.some((entry) => entry.placement === "expanded");
  const placed: PlacedCompose[] = [];
  let right = COMPOSE_EDGE_GAP / zoom;
  for (const [index, entry] of entries.toReversed().entries()) {
    if (entry.placement === "expanded") {
      placed.push({ ...entry, right: 0 });
      continue;
    }
    if (isOneExpanded && entry.placement === "docked") {
      continue;
    }
    const own = widthOf(entry);
    const room = width - right - COMPOSE_GAP;
    // The first that does not fit ends the row, and everything older with
    // it: a bar squeezed in past a window would put the windows out of order.
    if (own > room) {
      // The newest always stands, narrowed to the row: a window that is not
      // drawn is a New that appears to do nothing.
      if (index === 0 && room > 0) {
        placed.push({ ...entry, right, width: room });
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
  return entry.kind === "chat" ? CHAT_WINDOW_WIDTH : COMPOSE_WIDTH;
}
