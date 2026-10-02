/**
 * The tints a topic can be drawn on. Kept short and far apart: the color is
 * read out of the corner of the eye to tell one topic's mark from another, so
 * what matters is that two of them are never mistaken for each other.
 */

/**
 * The palette, as eight hues in two tiers, each hue rebuilt at one lightness
 * and chroma in OKLCH so no two are louder or quieter than each other. Only a
 * color's hue and its tier survive the tint, so the pairs are what a person
 * actually picks between: the same hue, once pale and once deep. Laid out as
 * two rows of eight, a hue to a column.
 */
export const TOPIC_COLORS = [
  // Pale.
  "#f2a7a6",
  "#ebaf86",
  "#d4bc79",
  "#99ce9a",
  "#78d1c0",
  "#82c7f0",
  "#bcb4f4",
  "#e8a7cb",
  // Deep.
  "#c0434c",
  "#b85300",
  "#996d00",
  "#218b30",
  "#009178",
  "#007fc3",
  "#765fca",
  "#b2468a",
];

/** How many hues the palette holds, which is the width of a row of swatches. */
const TOPIC_HUES = 8;

/** What stands in when a topic was never given a color and has no name to take one from. */
const FALLBACK_COLOR = "#007fc3";

/**
 * Whether a color is one of the pale tier, which the tint keeps pale. A color
 * from outside the palette is deep: it was chosen to be itself rather than
 * picked off a row.
 */
export function isPaleTopicColor(color: string) {
  const at = TOPIC_COLORS.indexOf(color);
  return at !== -1 && at < TOPIC_HUES;
}

/**
 * The color a topic is drawn in, wherever one is drawn: whatever the user
 * picked, and failing that one taken from the name, so a topic nobody marked
 * still keeps one color for as long as it is called that.
 */
export function topicColor(topic: { color?: string; name?: string }): string {
  if (topic.color) {
    return topic.color;
  }
  const name = topic.name ?? "";
  let sum = 0;
  for (const character of name) {
    sum += character.codePointAt(0) ?? 0;
  }
  // Off the deep tier: an unpicked color has to hold its own against the picked
  // ones beside it, and the pale row is chosen rather than fallen back on.
  const deep = TOPIC_COLORS.slice(TOPIC_HUES);
  return deep[sum % deep.length] ?? FALLBACK_COLOR;
}

/**
 * The marks a new topic is offered, in the order they are drawn on. Chosen to
 * be things a person would actually file work under rather than whatever the
 * picker's first row happens to hold.
 */
const STARTER_EMOJI = [
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
 * A mark for a topic about to be made: one of the starters, skipping any the
 * user already has, so a row of new topics does not come out as a line of the
 * same picture. Falls back to the whole set once they are all in use.
 */
export function starterEmoji(taken: readonly string[], seed: number): string {
  const free = STARTER_EMOJI.filter((emoji) => !taken.includes(emoji));
  const from = free.length > 0 ? free : STARTER_EMOJI;
  return from[Math.abs(seed) % from.length] ?? "🗂️";
}
