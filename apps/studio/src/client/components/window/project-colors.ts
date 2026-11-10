/**
 * The tints a project can be drawn on. Kept short and far apart: the color is
 * read out of the corner of the eye to tell one project's mark from another, so
 * what matters is that two of them are never mistaken for each other.
 */

import {
  PROJECT_COLORS,
  PROJECT_HUES,
} from "@instrument-org/shared/project-marks";

export { PROJECT_COLORS };

/** What stands in when a project was never given a color and has no name to take one from. */
const FALLBACK_COLOR = "#007fc3";

/**
 * Whether a color is one of the pale tier, which the tint keeps pale. A color
 * from outside the palette is deep: it was chosen to be itself rather than
 * picked off a row.
 */
export function isPaleProjectColor(color: string) {
  const at = PROJECT_COLORS.indexOf(color);
  return at !== -1 && at < PROJECT_HUES;
}

/**
 * The color a project is drawn in, wherever one is drawn: whatever the user
 * picked, and failing that one taken from the name, so a project nobody marked
 * still keeps one color for as long as it is called that.
 */
export function projectColor(project: {
  color?: string;
  name?: string;
}): string {
  if (project.color) {
    return project.color;
  }
  const name = project.name ?? "";
  let sum = 0;
  for (const character of name) {
    sum += character.codePointAt(0) ?? 0;
  }
  // Off the deep tier: an unpicked color has to hold its own against the picked
  // ones beside it, and the pale row is chosen rather than fallen back on.
  const deep = PROJECT_COLORS.slice(PROJECT_HUES);
  return deep[sum % deep.length] ?? FALLBACK_COLOR;
}

/**
 * The marks a new project is offered, in the order they are drawn on. Chosen to
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
 * A mark for a project about to be made: one of the starters, skipping any the
 * user already has, so a row of new projects does not come out as a line of the
 * same picture. Falls back to the whole set once they are all in use.
 */
export function starterEmoji(taken: readonly string[], seed: number): string {
  const free = STARTER_EMOJI.filter((emoji) => !taken.includes(emoji));
  const from = free.length > 0 ? free : STARTER_EMOJI;
  return from[Math.abs(seed) % from.length] ?? "🗂️";
}
