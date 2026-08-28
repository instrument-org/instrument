/**
 * The shapes a media card comes in, and the box each one takes.
 *
 * Its own module because the grid reserves a tile for a card that has not
 * arrived yet, and a reserved box able to drift from the card's own is the jump
 * it was drawn to prevent.
 */
export const MEDIA_CARD_ASPECT = {
  square: "aspect-square",
  wide: "aspect-3/2",
};

export type MediaCardShape = keyof typeof MEDIA_CARD_ASPECT;
