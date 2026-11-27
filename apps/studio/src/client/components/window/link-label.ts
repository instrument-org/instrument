import {
  PROJECT_COLORS,
  PROJECT_HUES,
} from "@instrument-org/shared/project-marks";

/** The colors a link group's label is filled with: the palette's deep row, which holds white words. */
export const LINK_COLORS: readonly string[] =
  PROJECT_COLORS.slice(PROJECT_HUES);

/**
 * The color a new link group takes: the first of `LINK_COLORS` the groups
 * open beside it wear least, so two open labels share one only once every
 * color is in use.
 */
export function newLinkColor(worn: readonly (string | undefined)[]): string {
  const counts = LINK_COLORS.map(
    (color) => worn.filter((each) => each === color).length,
  );
  const least = Math.min(...counts);
  return LINK_COLORS[counts.indexOf(least)] ?? LINK_COLORS[0] ?? "#007fc3";
}

/**
 * The color a link group's label is drawn in: the one it was given, and for a
 * group made before groups were given one, one taken from its word.
 */
export function linkColorOf(word: string, color: string | undefined): string {
  if (color !== undefined) {
    return color;
  }
  let sum = 0;
  for (const character of word.toLocaleLowerCase()) {
    sum += character.codePointAt(0) ?? 0;
  }
  return LINK_COLORS[sum % LINK_COLORS.length] ?? "#007fc3";
}
