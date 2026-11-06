/**
 * Where an arrow goes in a grid of tiles drawn by the browser's own auto-fill.
 * The rows and columns are read from where the tiles stand, since only the
 * browser knows how many fit.
 */

import { type ListingDirection } from "./file-system-keys";

type Place = { left: number; top: number };

/** How far apart two tiles can stand and still count as one row, in px. */
const SAME_ROW_PX = 1;

function isSameRow(a: Place, b: Place) {
  return Math.abs(a.top - b.top) <= SAME_ROW_PX;
}

/**
 * The tile an arrow reaches, or null where it stays.
 *
 * In order across, as the keyboard reads tiles on Windows and Linux: Left and
 * Right walk the order, wrapping between rows, and Up and Down take the closest
 * tile in the nearest row that way.
 *
 * By place, on the Mac: Left and Right stay in their row. Right off the last
 * tile of a short row goes up into the next column, where one is there. Up and
 * Down stop short of a tile more than a column away. With nothing selected, Up
 * takes the last tile and Left the last of the last full row.
 */
export function gridNeighbor<T extends { path: string }>({
  byPlace,
  current,
  direction,
  entries,
  placeOf,
}: {
  byPlace: boolean;
  current: null | string;
  direction: ListingDirection;
  entries: readonly T[];
  /** Where a tile stands, or null for one not drawn. */
  placeOf: (path: string) => null | Place;
}): null | T {
  const at = entries.findIndex((entry) => entry.path === current);
  const places = entries.flatMap((entry) => {
    const place = placeOf(entry.path);
    return place ? [{ entry, place }] : [];
  });
  if (at === -1) {
    if (byPlace && direction === "up") return entries.at(-1) ?? null;
    if (byPlace && direction === "left") {
      const [firstDrawn] = places;
      const columns = firstDrawn
        ? places.filter(({ place }) => isSameRow(place, firstDrawn.place))
            .length
        : 0;
      const full =
        columns > 0 ? entries.length - (entries.length % columns) : 0;
      return entries[full - 1] ?? entries.at(-1) ?? null;
    }
    return entries[0] ?? null;
  }
  const here = placeOf(entries[at]?.path ?? "");
  if (direction === "left" || direction === "right") {
    const step = direction === "left" ? -1 : 1;
    const next = entries[at + step] ?? null;
    if (!byPlace) return next;
    const nextPlace = next && placeOf(next.path);
    if (!here) return next;
    if (nextPlace && isSameRow(nextPlace, here)) return next;
    if (direction === "left" || next) return null;
    // The last tile of all: the next column over, in the nearest row above.
    return (
      places
        .filter(
          ({ place }) => place.left > here.left + 1 && place.top < here.top,
        )
        .toSorted(
          (a, b) => b.place.top - a.place.top || a.place.left - b.place.left,
        )[0]?.entry ?? null
    );
  }
  if (!here) return null;
  const lefts = [...new Set(places.map(({ place }) => place.left))].toSorted(
    (a, b) => a - b,
  );
  const column = Math.min(
    ...lefts.slice(1).map((left, index) => left - (lefts[index] ?? left)),
  );
  let best: null | T = null;
  let bestScore = Infinity;
  for (const { entry, place } of places) {
    if (entry.path === current) continue;
    const rowDelta =
      direction === "down" ? place.top - here.top : here.top - place.top;
    if (rowDelta <= SAME_ROW_PX) continue;
    const away = Math.abs(place.left - here.left);
    if (byPlace && away > column * 1.5) continue;
    const score = rowDelta * 1000 + away;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}
