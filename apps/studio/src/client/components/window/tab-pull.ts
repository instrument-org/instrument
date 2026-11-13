/** Past the row this far, heading away from it, and the tab comes off. */
const PULL_PX = 10;
/** Past the row this far and the tab comes off whichever way it is heading. */
const SWEEP_PX = 44;
/** Past the window's side this far and the tab comes off. */
const SIDE_PX = 16;
/** Past the window's top or foot this far and a tab comes off the window. */
const OFF_WINDOW_PX = 16;
/** How much of its recent path says which way a pointer is heading. */
const HEADING_MS = 90;
/** How steep a path has to be to read as a pull rather than a sweep along the row. */
const PULL_SLOPE = 0.6;

export interface PointerSample {
  at: number;
  x: number;
  y: number;
}

/** The samples still worth reading, with this one added. */
export function recentPath(
  path: readonly PointerSample[],
  sample: PointerSample,
) {
  return [...path.filter(({ at }) => sample.at - at <= HEADING_MS), sample];
}

/**
 * Whether a tab being dragged has left its row, going by where the pointer is
 * heading as well as where it is. A hand sweeping along the row drifts off it
 * and means nothing by that, so a path along the row gets room, and one heading
 * away from the row comes off almost at once. A tab off its row comes back only
 * once the pointer is back on it, so that it does not flicker at the edge.
 */
export function isOffRow({
  path,
  strip,
  wasOff,
  windowWidth,
}: {
  path: readonly PointerSample[];
  strip: { bottom: number; top: number };
  wasOff: boolean;
  windowWidth: number;
}) {
  const point = path.at(-1);
  if (!point) {
    return wasOff;
  }
  if (point.x < -SIDE_PX || point.x > windowWidth + SIDE_PX) {
    return true;
  }
  const below = point.y - strip.bottom;
  const above = strip.top - point.y;
  const past = Math.max(below, above);
  if (past <= 0) {
    return false;
  }
  if (wasOff || past >= SWEEP_PX) {
    return true;
  }
  const first = path[0] ?? point;
  const across = Math.abs(point.x - first.x);
  const away = below > 0 ? point.y - first.y : first.y - point.y;
  return past >= PULL_PX && away > 0 && away >= across * PULL_SLOPE;
}

/**
 * Whether a tab being dragged is off its window altogether, by where the
 * pointer is in the window's own px: past a side as a tab leaves its row,
 * and past the top or the foot by as much.
 */
export function isOffWindow(
  point: { x: number; y: number },
  window: { height: number; width: number },
) {
  return (
    point.x < -SIDE_PX ||
    point.x > window.width + SIDE_PX ||
    point.y < -OFF_WINDOW_PX ||
    point.y > window.height + OFF_WINDOW_PX
  );
}
