/**
 * A side's narrowest, in layout px: a page's row still fits once it has
 * folded what it folds (`ROW_FOLDS`), with room in its field for an address,
 * and most sites lay out at it, being a phone's width. A group too narrow for
 * its sides at this scrolls sideways rather than squeezing either.
 */
export const SIDE_WIDTH_MIN = 320;

/** How near the middle, in layout px, a dragged gutter settles on it. */
const SIDE_SNAP_PX = 15;

/** The left side's share of two sides nobody sized, neither of them sized as a chat. */
export const SIDE_SHARE_DEFAULT = 0.5;

/**
 * A chat's width beside a page, in layout px: its cards stop growing at 460,
 * inside the transcript's 32 of padding. Layout px scale with the window's
 * zoom, so it fits the same at any zoom.
 */
const CHAT_WIDTH = 500;

/** The narrowest a chat gives up room to, for the page beside it. */
const CHAT_WIDTH_TIGHT = 360;

/** The width a chat gives up room to keep the page beside it at, where many sites lay out past a phone's. */
const PAGE_WIDTH = 768;

/**
 * The left side's share of the room two sides split, where the gutter
 * stands: the share the person dragged it to, else by which side is sized
 * as a chat (`chatSideOf`), else the middle. A chat takes the width it needs
 * and the page the rest. Where the page would be under its own width the
 * chat gives up room, down to its tightest, and never takes more than half
 * to keep that.
 */
export function sideShare({
  chatSide,
  room,
  share,
}: {
  chatSide: 0 | 1 | undefined;
  room: number;
  share: number | undefined;
}) {
  if (share !== undefined) {
    return share;
  }
  if (chatSide === undefined || room <= 0) {
    return SIDE_SHARE_DEFAULT;
  }
  const wanted = Math.min(
    Math.max(room - PAGE_WIDTH, CHAT_WIDTH_TIGHT),
    CHAT_WIDTH,
  );
  const chat = Math.min(wanted, room / 2) / room;
  return chatSide === 0 ? chat : 1 - chat;
}

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

/**
 * Where a row scrolled sideways to `scroll`, showing `view` of it, scrolls to
 * show a side standing from `start` to `end`: the least move that shows it
 * whole, or its start when it is wider than the view.
 */
export function scrollToShow({
  end,
  scroll,
  start,
  view,
}: {
  end: number;
  scroll: number;
  start: number;
  view: number;
}) {
  if (end - start > view || start < scroll) {
    return start;
  }
  return end > scroll + view ? end - view : scroll;
}
