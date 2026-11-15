/**
 * The look of a place in a list or a bar that takes what is held: a row it
 * joins, the row it would make, a bookmark standing where it would be kept.
 * Raised as what is held is raised on the pointer (`HELD_LOOK`), with a
 * hairline that marks it lit. Neutral in both themes, never the brand's
 * green.
 */
export const DROP_TONE =
  "bg-card shadow-[0_6px_16px_rgb(0_0_0/0.14)] ring-[1.5px] ring-foreground/30 ring-inset dark:shadow-[0_6px_16px_rgb(0_0_0/0.5)]";

/**
 * The tone of a stretch of a page that takes what is held, a side it joins,
 * the half a split takes or a new tab it turns into: the brand's dashed
 * edge and wash that the composer's box and a folder in Files take a drop
 * with, so every place that takes one reads alike, and never the solid
 * outline of the side with the keyboard.
 */
export const DROP_AREA_TONE =
  "border-2 border-dashed border-brand-500 bg-brand-500/5";

/** What is held as it rides on the pointer: raised off the window with a shadow, at full strength. */
export const HELD_LOOK =
  "bg-card text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)]";
