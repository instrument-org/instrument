/**
 * The name a page gives itself, read from its HTML the way a browser's tab
 * reads it: its `<title>`, then the title it gives link previews
 * (`og:title`, then `twitter:title`), then its first `<h1>`. Undefined when
 * it names itself none of those.
 *
 * Only the document's own title counts: one inside an SVG names the picture,
 * and scripts, styles, templates and comments are not the page's words.
 */
export function pageTitle(html: string): string | undefined {
  const page = html.replace(NOT_THE_PAGES_WORDS, "");
  return (
    plainText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(page)?.[1]) ??
    plainText(metaContent(page, "og:title")) ??
    plainText(metaContent(page, "twitter:title")) ??
    plainText(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(page)?.[1])
  );
}

/** How long a title is kept, which covers any a reader would take in. */
const MAX_TITLE_LENGTH = 300;

const NOT_THE_PAGES_WORDS =
  /<!--[\s\S]*?-->|<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi;

/** The `content` of the `<meta>` whose `property` or `name` is `key`. */
function metaContent(html: string, key: string): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map(
      Array.from(
        tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g),
        (match) => [
          match[1]?.toLowerCase() ?? "",
          match[2] ?? match[3] ?? match[4] ?? "",
        ],
      ),
    );
    const named = attributes.get("property") ?? attributes.get("name");
    if (named?.toLowerCase() === key) {
      return attributes.get("content");
    }
  }
  return undefined;
}

/** Text with its tags taken out, its entities read, and its spaces collapsed; undefined when nothing is left. */
export function plainText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const words = decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return words === "" ? undefined : words;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1]?.toLowerCase() === "x"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10_ff_ff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}
