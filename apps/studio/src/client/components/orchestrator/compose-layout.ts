import { type ComposeEntry } from "@/client/atoms/orchestrator";

/** A docked draft window's width and a bar's, in layout px, which is how the foot is laid out. */
export const COMPOSE_WIDTH = 600;
export const COMPOSE_BAR_WIDTH = 300;

/**
 * The window layer a draft's page guest is shown on: above the draft windows
 * (`z-40`) so the page is not under its own opaque window, and under every
 * menu and popover (`z-50`), which stay over the page the way they do over
 * the pane's.
 */
export const COMPOSE_GUEST_LAYER = 41;

/** The room between two windows along the foot, and between the last and the edge, in layout px. */
export const COMPOSE_GAP = 12;

/** A draft window with its place along the foot: how far its right edge stands from the row's. */
export interface PlacedCompose extends ComposeEntry {
  right: number;
}

/**
 * Lays the open drafts along the foot the way a mail client does: the newest
 * at the right edge, each older one beside the last, and the ones there is
 * no room for left out from the left, so the row never wraps or squeezes. A
 * window grown to fill the row stands alone among the windows; the bars
 * along the foot stay in their places under it.
 */
export function layoutCompose(
  entries: ComposeEntry[],
  width: number,
): PlacedCompose[] {
  const isOneExpanded = entries.some((entry) => entry.placement === "expanded");
  const placed: PlacedCompose[] = [];
  let right = COMPOSE_GAP;
  for (const entry of entries.toReversed()) {
    if (entry.placement === "expanded") {
      placed.push({ ...entry, right: 0 });
      continue;
    }
    if (isOneExpanded && entry.placement === "docked") {
      continue;
    }
    const own = entry.placement === "bar" ? COMPOSE_BAR_WIDTH : COMPOSE_WIDTH;
    // The first that does not fit ends the row, and everything older with
    // it: a bar squeezed in past a window would put the drafts out of order.
    if (right + own + COMPOSE_GAP > width) {
      break;
    }
    placed.push({ ...entry, right });
    right += own + COMPOSE_GAP;
  }
  return placed;
}
