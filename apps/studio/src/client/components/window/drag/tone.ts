/**
 * The two looks a place takes what is held in, chosen by what letting go
 * there does, so every place that takes a drop wears one of these and
 * nothing of its own.
 *
 * - `attach`: the brand's dashed edge and wash, kept for a composer's box,
 *   where letting go attaches files to the message.
 * - `open`: a solid edge in the theme's ring color, at the ink of the
 *   outline of the side with the keyboard, over a faint wash, for
 *   every place where letting go opens or moves something: a side, the half
 *   a split takes, a split target the pointer nears, a new tab, a folder in
 *   Files. Drawn inside its place and washed, where that outline
 *   (`FOCUSED_SIDE`) is drawn outside its card, so the two never read as
 *   the same mark.
 */
export const DROP_LOOK = {
  attach: "border-2 border-dashed border-brand-500 bg-brand-500/5",
  open: "bg-ring/10 ring-2 ring-ring/75 ring-inset",
} as const;

/** `DROP_LOOK.open`'s edge alone, for a place with a ground of its own. */
const OPEN_EDGE = "ring-2 ring-ring/75 ring-inset";

/**
 * The look of a place in a list or a bar that takes what is held: a row it
 * joins, the row it would make, a bookmark standing where it would be kept.
 * Raised as what is held is raised on the pointer (`HELD_LOOK`), edged as
 * every place letting go opens something is (`DROP_LOOK.open`), on the
 * card's own ground rather than its wash.
 */
export const DROP_TONE = `${OPEN_EDGE} bg-card shadow-[0_6px_16px_rgb(0_0_0/0.14)] dark:shadow-[0_6px_16px_rgb(0_0_0/0.5)]`;

/** What is held as it rides on the pointer: raised off the window with a shadow, at full strength. */
export const HELD_LOOK =
  "bg-card text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)]";
