/**
 * The tints a channel can be drawn on. Kept short and far apart: the color is
 * read out of the corner of the eye to know which channel you are in, so what
 * matters is that two of them are never mistaken for each other.
 */
/**
 * The color the channel the conversation started in is drawn in: the app's
 * own, so its room reads as the app's rather than as one more workspace.
 */
export const HOME_CHANNEL_COLOR = "#0b6056";

/**
 * The palette, as eight hues in two tiers. Only a color's hue and its tier
 * survive the tint, so the pairs are what a person actually picks between: the
 * same hue, once pale and once deep. Laid out as two rows of eight, a hue to a
 * column.
 */
export const CHANNEL_COLORS = [
  // Pale.
  "#7ea8ff",
  "#ff9e7a",
  "#5fd3ab",
  "#bda0ff",
  "#f0cf6b",
  "#6cc7e0",
  "#f58ab5",
  "#a9d95f",
  // Deep.
  "#3b6ef6",
  "#e0562f",
  "#0f9d6e",
  "#8b5cf6",
  "#d4a017",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

/** How many hues the palette holds, which is the width of a row of swatches. */
export const CHANNEL_HUES = 8;

/**
 * Whether a color is one of the pale tier, which the tint keeps pale. A color
 * from outside the palette, such as the app's own, is deep: it was chosen to
 * be itself rather than picked off a row.
 */
export function isPaleChannelColor(color: string) {
  const at = CHANNEL_COLORS.indexOf(color);
  return at !== -1 && at < CHANNEL_HUES;
}

/**
 * The marks a new channel is offered, in the order they are drawn on. Chosen
 * to be things a person would actually name a piece of work after rather than
 * whatever the picker's first row happens to hold.
 */
export const STARTER_EMOJI = [
  "🛒",
  "🔬",
  "🧵",
  "📓",
  "🧾",
  "✈️",
  "🏠",
  "📚",
  "💼",
  "🎧",
  "🛠️",
  "🎬",
  "🍋",
  "🌱",
  "📸",
  "🗺️",
  "⚗️",
  "🧮",
  "🪴",
  "🧭",
  "🎯",
  "📦",
  "🗂️",
  "💡",
];

/**
 * A mark for a channel about to be made: one of the starters, skipping any the
 * user already has, so a rail of new channels does not come out as a column of
 * the same picture. Falls back to the whole set once they are all in use.
 */
export function starterEmoji(taken: readonly string[], seed: number): string {
  const free = STARTER_EMOJI.filter((emoji) => !taken.includes(emoji));
  const from = free.length > 0 ? free : STARTER_EMOJI;
  return from[Math.abs(seed) % from.length] ?? "🗂️";
}
