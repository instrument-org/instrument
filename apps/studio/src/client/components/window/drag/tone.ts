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
 * The tone of a stretch of a page that takes what is held, a side it joins
 * or a new tab it turns into: a mid gray rather than the theme's
 * foreground, so it shows over a white web page in the dark theme as well
 * as over the app.
 */
export const DROP_AREA_TONE =
  "bg-[rgb(128_128_128/0.12)] ring-2 ring-[rgb(128_128_128/0.85)] ring-inset";

/** What is held as it rides on the pointer: raised off the window with a shadow, at full strength. */
export const HELD_LOOK =
  "bg-card text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)]";
