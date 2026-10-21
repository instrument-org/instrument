/**
 * A Markdown file's front matter, wherever the app reads one: a skill, a
 * memory, a topic, a draft, an app, and every file the editor and the viewer
 * draw.
 *
 * The block opens with `---` on the file's first line and closes at the
 * first line that is `---` or `...`, trailing spaces allowed on either. A
 * leading byte-order mark is part of the front matter, so `fm + body` is the
 * file's text byte for byte.
 */
export type FrontMatterSplit =
  | {
      /**
       * The YAML between the fences, newlines as `\n`, starting with the
       * newline after the opening fence so a YAML error's line number is the
       * line in the file.
       */
      block: string;
      /** Everything after the closing fence's line. */
      body: string;
      /** The front matter as written, fences and all. */
      fm: string;
      ok: true;
    }
  | {
      body: string;
      fm: "";
      ok: false;
      reason: "no-frontmatter" | "unterminated";
    };

/** The opening fence; `----` is a horizontal rule. */
const OPENING = /^\uFEFF?---[ \t]*\r?\n/;

/** A closing fence, as a whole line. */
const CLOSING = /^(?:---|\.\.\.)[ \t]*\r?$\n?/gm;

/** A file's text as its front matter and the body after it. */
export function splitFrontMatter(text: string): FrontMatterSplit {
  const opening = OPENING.exec(text);
  if (!opening) {
    return { body: text, fm: "", ok: false, reason: "no-frontmatter" };
  }
  const start = opening[0].length;
  const closing = new RegExp(CLOSING.source, CLOSING.flags);
  closing.lastIndex = start;
  const close = closing.exec(text);
  if (!close) {
    return { body: text, fm: "", ok: false, reason: "unterminated" };
  }
  const end = close.index + close[0].length;
  const inner = text.slice(start, close.index).replaceAll("\r\n", "\n");
  return {
    block: `\n${inner}`.replace(/\n$/, ""),
    body: text.slice(end),
    fm: text.slice(0, end),
    ok: true,
  };
}
