/**
 * What a press dragged across empty space selects, as plain geometry: a box
 * over the icons, a run of rows in the list and the columns. The views are
 * windowed, so most of what a drag reaches is not in the DOM: each view says
 * where its rows or tiles stand, and these find the ones reached by
 * arithmetic.
 */

/** A rectangle in the coordinates of the view's own content. */
export type Box = { height: number; width: number; x: number; y: number };

export type Point = { x: number; y: number };

/** The box from where the press began to where the pointer is now. */
export function boxBetween(from: Point, to: Point): Box {
  return {
    height: Math.abs(to.y - from.y),
    width: Math.abs(to.x - from.x),
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
  };
}

/** Whether two boxes share any area, an edge touching included. */
export function overlaps(left: Box, right: Box) {
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  );
}

/**
 * The rows a drag down or up a stack (a list, a column) runs over, by index:
 * every row from the one the press was nearest (the last, for a press past
 * the rows) to the one under the pointer, the way the Finder's list and
 * columns select a run rather than drawing a box. Rows are `stride` apart
 * from `top`; how far across the pointer is makes no difference.
 */
export function runHits({
  count,
  from,
  stride,
  to,
  top = 0,
}: {
  count: number;
  from: number;
  stride: number;
  to: number;
  top?: number;
}): number[] {
  if (count === 0 || stride <= 0) return [];
  const rowAt = (y: number) =>
    Math.min(count - 1, Math.max(0, Math.floor((y - top) / stride)));
  const first = Math.min(rowAt(from), rowAt(to));
  const last = Math.max(rowAt(from), rowAt(to));
  return Array.from({ length: last - first + 1 }, (_, at) => first + at);
}

/**
 * Where the tile at `column` of a grid of `columnCount` equal tracks stands
 * across `width`, `gap` apart: only its glyph and name, `tileWidth` wide and
 * centered in the track, so a box through the space between tiles takes none.
 */
export function gridTileSpan({
  column,
  columnCount,
  gap,
  tileWidth,
  width,
}: {
  column: number;
  columnCount: number;
  gap: number;
  tileWidth: number;
  width: number;
}) {
  const track = (width - gap * (columnCount - 1)) / columnCount;
  const shown = Math.min(track, tileWidth);
  return {
    width: shown,
    x: column * (track + gap) + (track - shown) / 2,
  };
}

/**
 * How fast the view scrolls while the pointer is held near or past one of
 * its edges, in px per frame: none farther than `edge` inside, faster the
 * deeper it goes, to `max`. Negative scrolls up.
 */
export function edgeScrollSpeed({
  bottom,
  edge = 24,
  max = 24,
  pointer,
  top,
}: {
  bottom: number;
  edge?: number;
  max?: number;
  pointer: number;
  top: number;
}) {
  if (pointer < top + edge) {
    return -Math.min(max, Math.ceil((top + edge - pointer) / 2));
  }
  if (pointer > bottom - edge) {
    return Math.min(max, Math.ceil((pointer - (bottom - edge)) / 2));
  }
  return 0;
}
