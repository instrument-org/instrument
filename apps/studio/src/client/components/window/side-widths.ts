/**
 * A side's narrowest, in layout px: room for a chat's composer and for the
 * toolbar's arrows, reload and an address worth reading. A group too narrow
 * for its sides at this scrolls sideways rather than squeezing either.
 */
export const SIDE_WIDTH_MIN = 440;

/** How near the middle, in layout px, a dragged gutter settles on it. */
const SIDE_SNAP_PX = 15;

/** The left side's share of a group of two sides that has none kept. */
export const SIDE_SHARE_DEFAULT = 0.5;

/**
 * The left side's width at a share of the room two sides split past the
 * gutter, as the row lays it out: neither side below its narrowest, so a
 * share kept from a wider window stops at the right side's floor.
 */
export function leftWidthAt(share: number, room: number) {
  if (room < SIDE_WIDTH_MIN * 2) {
    return share * room;
  }
  return Math.min(
    Math.max(share * room, SIDE_WIDTH_MIN),
    room - SIDE_WIDTH_MIN,
  );
}

/** The share a gutter dragged to `width` keeps, settling on the middle near it. */
export function shareAt(width: number, room: number) {
  if (room <= 0) {
    return SIDE_SHARE_DEFAULT;
  }
  const clamped = Math.min(
    Math.max(width, SIDE_WIDTH_MIN),
    Math.max(room - SIDE_WIDTH_MIN, SIDE_WIDTH_MIN),
  );
  return Math.abs(clamped - room / 2) <= SIDE_SNAP_PX
    ? SIDE_SHARE_DEFAULT
    : clamped / room;
}
