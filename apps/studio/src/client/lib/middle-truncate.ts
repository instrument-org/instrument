/**
 * Cutting a name in its middle to fit a width, the way the Finder shows a
 * long file name: its start and its end stay, and an ellipsis stands for
 * what is left out. The text is measured with a canvas in the font it is
 * drawn in, each string's width remembered per font, and the cut found by a
 * binary search over its graphemes, so a name costs a few measures the
 * first time and none after.
 */

export const ELLIPSIS = "…";

/** Widths by font, then by string. */
const widths = new Map<string, Map<string, number>>();
let context: CanvasRenderingContext2D | null | undefined;

/** How a run of text is drawn, as the canvas takes it. */
export type TextFont = { font: string; letterSpacing: string };

/** The font an element's text is drawn in. */
export function fontOf(element: Element): TextFont {
  const style = getComputedStyle(element);
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    letterSpacing:
      style.letterSpacing === "normal" ? "0px" : style.letterSpacing,
  };
}

/** The zoom an element is drawn at, from the app's zoom and any of its own. */
export function cssZoomOf(element: Element) {
  return "currentCSSZoom" in element &&
    typeof element.currentCSSZoom === "number"
    ? element.currentCSSZoom
    : 1;
}

/**
 * An element's width in its own CSS pixels, to the fraction: what
 * `clientWidth` gives rounded, which differs by a pixel with where the
 * element sits.
 */
export function layoutWidth(element: Element) {
  return element.getBoundingClientRect().width / cssZoomOf(element);
}

/** The width of a string in a font, in CSS pixels. */
export function textWidth(text: string, { font, letterSpacing }: TextFont) {
  const key = `${font}|${letterSpacing}`;
  let known = widths.get(key);
  if (!known) {
    known = new Map();
    widths.set(key, known);
  }
  const cached = known.get(text);
  if (cached !== undefined) {
    return cached;
  }
  if (context === undefined) {
    context = document.createElement("canvas").getContext("2d");
  }
  if (!context) {
    return 0;
  }
  context.font = font;
  context.letterSpacing = letterSpacing;
  const width = context.measureText(text).width;
  known.set(text, width);
  return width;
}

/**
 * Forgets every width measured, for a font that finished loading after text
 * in it was measured with its fallback.
 */
export function forgetTextWidths() {
  widths.clear();
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string) {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** A file name's extension, pinned to the end of a cut: `.pdf`, `.tar.gz`. */
const EXTENSION = /(?:\.tar)?\.[\p{L}\p{N}]{1,8}$/u;

/**
 * The text cut in its middle to fit `width`, or the text itself when it
 * fits. With `extension`, a file name's extension stays whole after the
 * ellipsis while the rest of the name has room for a letter on each side.
 * When not even one letter on each side fits, it gives back what fits of
 * the start, for the element's own clipping to end.
 */
export function fitMiddle(
  text: string,
  width: number,
  font: TextFont,
  { extension = false }: { extension?: boolean } = {},
) {
  if (textWidth(text, font) <= width) {
    return text;
  }
  const match = extension ? EXTENSION.exec(text) : null;
  const end = match && match.index > 0 ? match[0] : "";
  const stem = graphemes(end ? text.slice(0, -end.length) : text);
  const cut = (kept: number) => {
    const head = Math.ceil(kept / 2);
    const tail = kept - head;
    return (
      stem.slice(0, head).join("") +
      ELLIPSIS +
      (tail > 0 ? stem.slice(-tail).join("") : "") +
      end
    );
  };
  // The most graphemes kept that still fit, between both ends.
  let low = 0;
  let high = stem.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textWidth(cut(middle), font) <= width) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low >= 2) {
    return cut(low);
  }
  // Too narrow for the extension too: cut the whole name instead.
  if (end) {
    return fitMiddle(text, width, font);
  }
  return low > 0 ? cut(low) : text;
}

/** Where a name may break onto its next line, after a space, hyphen, underscore or dot, as the Finder breaks one. */
const BREAK_AFTER = /[-_.\s]/;

/**
 * A name on at most two lines, the way the Finder labels an icon: the first
 * line as full as it gets, broken after a space, hyphen, underscore or dot
 * where one falls in its second half, and the rest on the second line, cut
 * in its middle when it is still too long.
 */
export function fitTwoLines(
  text: string,
  width: number,
  font: TextFont,
  options: { extension?: boolean } = {},
): [string] | [string, string] {
  if (textWidth(text, font) <= width) {
    return [text];
  }
  const parts = graphemes(text);
  let low = 1;
  let high = parts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textWidth(parts.slice(0, middle).join(""), font) <= width) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let first = low;
  for (let at = low; at > low / 2; at -= 1) {
    if (BREAK_AFTER.test(parts[at - 1] ?? "")) {
      first = at;
      break;
    }
  }
  const rest = parts.slice(first).join("").trimStart();
  return [
    parts.slice(0, first).join("").trimEnd(),
    fitMiddle(rest, width, font, options),
  ];
}
