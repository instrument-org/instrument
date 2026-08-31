/** One link found in a line of text somebody typed, and the text around it. */
export type LinkTextSegment =
  | { href: string; label: string; type: "link" }
  | { text: string; type: "text" };

// A Markdown inline link whose destination is a page or an address. The label
// may not cross a line or hold a bracket, and the destination may hold one level
// of balanced parentheses, which is what a URL ending in one needs. A label has
// to open with something to read: `[](…)` is a typo, and there is nothing there
// to click.
const MARKDOWN_LINK =
  /\[([^\s\]][^\]\n]*)\]\(((?:https?:\/\/|mailto:)(?:[^\s()]|\([^\s()]*\))+)\)/gu;

// A destination written on its own, which is how nearly everyone actually
// writes one. Bounded by whitespace and by the brackets a Markdown link puts
// around its own destination, so the two passes can never claim the same run.
const BARE_LINK =
  /https?:\/\/[^\s<>[\]]+|[^\s<>[\]()@,;:]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;

// What a sentence puts after a link rather than inside one.
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/u;

/**
 * Split a line into the links it carries and the text around them.
 *
 * A linkifier for text a person wrote, not a Markdown parser: it reads the two
 * shapes a link is actually written in and leaves everything else as the text it
 * is. That is the whole safety argument for running it over somebody's own
 * words, since a shape it cannot read cannot become something clickable.
 *
 * Markdown links are taken first, so the bare pass can never claim a
 * destination that was already inside one.
 */
export function splitLinks(text: string): LinkTextSegment[] {
  return splitBy(text, MARKDOWN_LINK, (match) => ({
    href: match[2] ?? "",
    label: match[1] ?? "",
    type: "link",
  })).flatMap((segment) =>
    segment.type === "text" ? splitBareLinks(segment.text) : [segment],
  );
}

function splitBareLinks(text: string): LinkTextSegment[] {
  return splitBy(text, BARE_LINK, (match) => {
    const found = trimTrailing(match[0]);
    return {
      href: found.includes("://") ? found : `mailto:${found}`,
      label: found,
      // What the trim took back is text again, so the caller puts it after the
      // link rather than inside it.
      rest: match[0].slice(found.length),
      type: "link",
    };
  });
}

const openers = (text: string) => text.split("(").length - 1;
const closers = (text: string) => text.split(")").length - 1;

/**
 * The shared shape of both passes: walk the matches, keep what is between them
 * as text, and let the caller say what a match becomes. A `rest` on what comes
 * back is text the caller handed off the end of its own match.
 */
function splitBy(
  text: string,
  pattern: RegExp,
  toSegment: (match: RegExpExecArray) => LinkTextSegment & { rest?: string },
): LinkTextSegment[] {
  const segments: LinkTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const { rest, ...segment } = toSegment(match);
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), type: "text" });
    }
    cursor = match.index + match[0].length;

    segments.push(segment);
    if (rest) {
      segments.push({ text: rest, type: "text" });
    }
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: "text" });
  }

  return segments;
}

/**
 * A bare link ends where the sentence around it does. Parentheses are the
 * exception worth handling: one at the end belongs to the URL only if the URL
 * opened it, which is what tells `…/Foo_(bar)` from `(see …/Foo)`.
 */
function trimTrailing(found: string): string {
  let trimmed = found.replace(TRAILING_PUNCTUATION, "");
  while (trimmed.endsWith(")") && closers(trimmed) > openers(trimmed)) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return trimmed;
}
