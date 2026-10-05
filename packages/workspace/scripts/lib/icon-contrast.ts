/**
 * A one-color mark given its reversed form for the theme its own color
 * disappears in. Most services' marks are one flat color, and the ones drawn
 * near black (or a pale yellow) are unreadable on one theme's ground. No
 * collection draws a dark-mode version of most of them, so the refresh
 * script makes the one nearly every brand's own guidelines publish beside
 * its mark: the same paths in plain white for a dark ground, plain black for
 * a light one. Never a new hue: a brand color the brand never chose is a
 * redrawn mark, and the directory shows marks as published.
 *
 * Only a mark that is one color is touched. A mark of several colors is its
 * brand's own picture and is left as drawn.
 */

/** Card and menu ground in dark mode, where most small marks sit. */
const DARK_GROUND = "#292524";
const LIGHT_GROUND = "#ffffff";
/**
 * Below this a mark is gone, not merely soft. Well under WCAG's 3:1 for
 * graphics on purpose: a brand mark is known by its shape and hue, so
 * Spotify's green on white (1.9:1) and Stripe's purple on the dark card
 * (2.5:1) read as themselves and keep their color; a near-black mark on the
 * dark card (1.0 to 1.5:1) does not.
 */
const MIN_CONTRAST = 1.6;

const SHAPES = "path|rect|circle|ellipse|polygon|polyline|line|text|use";
const NAMED: Record<string, string> = {
  black: "#000000",
  currentcolor: "#000000",
  white: "#ffffff",
};

/**
 * The light and dark halves for a mark, given the collection's light one:
 * `undefined` when its color reads in both themes or it is not one color,
 * else the reversed half that theme needs. A mark too pale for light mode
 * keeps its color as the dark half and is black in the light one.
 */
export function themeHalves(
  svg: string,
): undefined | { dark: string; light: string } {
  const color = soleColor(svg);
  if (!color) {
    return undefined;
  }
  if (contrast(color, DARK_GROUND) < MIN_CONTRAST) {
    return { dark: recolor(svg, "#ffffff"), light: svg };
  }
  if (contrast(color, LIGHT_GROUND) < MIN_CONTRAST) {
    return { dark: svg, light: recolor(svg, "#000000") };
  }
  return undefined;
}

/**
 * The one color every painted thing in the mark is drawn in, as `#rrggbb`,
 * or `undefined` for a mark of several colors or one this cannot read. A
 * shape with no fill of its own, under nothing that gives it one, is black.
 */
export function soleColor(svg: string): string | undefined {
  const colors = new Set<string>();
  for (const match of svg.matchAll(
    /(?:\s(?:fill|stroke|stop-color)\s*=\s*["']([^"']*)["'])|(?:(?:^|[;{\s"'])(?:fill|stroke|stop-color)\s*:\s*([^;}"']+))/gi,
  )) {
    const value = (match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (
      value === "none" ||
      value === "transparent" ||
      value.startsWith("url(")
    ) {
      continue;
    }
    const hex = toHex(value);
    if (!hex) {
      return undefined;
    }
    colors.add(hex);
  }
  const containerFill = /<(?:svg|g)\b[^>]*\sfill\s*=/i.test(svg);
  const bareShape = [
    ...svg.matchAll(new RegExp(String.raw`<(?:${SHAPES})\b[^>]*>`, "gi")),
  ].some(([tag]) => !/\sfill\s*=|fill\s*:/i.test(tag));
  if (bareShape && !containerFill) {
    colors.add("#000000");
  }
  return colors.size === 1 ? [...colors][0] : undefined;
}

/** The mark with its one color, and any shape left to default to black, in `color`. */
export function recolor(svg: string, color: string): string {
  const painted = svg
    .replaceAll(
      /(\s(?:fill|stroke|stop-color)\s*=\s*["'])([^"']*)(["'])/gi,
      (whole, open: string, value: string, close: string) =>
        isPaint(value) ? `${open}${color}${close}` : whole,
    )
    .replaceAll(
      /((?:^|[;{\s"'])(?:fill|stroke|stop-color)\s*:\s*)([^;}"']+)/gi,
      (whole, open: string, value: string) =>
        isPaint(value) ? `${open}${color}` : whole,
    );
  // A shape with no fill of its own takes the root's, where it took black.
  return painted.replace(/^<svg\b(?![^>]*\sfill\s*=)/i, `<svg fill="${color}"`);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function isPaint(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower !== "none" && lower !== "transparent" && !lower.startsWith("url(")
  );
}

function toHex(value: string): string | undefined {
  const named = NAMED[value];
  if (named) {
    return named;
  }
  const short = /^#([0-9a-f]{3})[0-9a-f]?$/.exec(value)?.[1];
  if (short) {
    return `#${short.replaceAll(/./g, "$&$&")}`;
  }
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(value)?.[1];
  if (long) {
    return `#${long}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return undefined;
}

/** The color's channels in linear light, 0 to 1. */
function linearChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ];
}

function toLinear(v: number): number {
  return v <= 0.040_45 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = linearChannels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
