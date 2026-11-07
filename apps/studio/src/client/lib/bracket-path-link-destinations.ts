/**
 * Wraps a link destination that is a file path with spaces in angle brackets,
 * so `[notes](C:\Users\sam\My Notes\a.md)` parses as the link it was meant to be.
 *
 * Markdown ends a bare destination at its first space, so a model linking a
 * file in a folder named with spaces gets the whole link as literal text. The
 * bracketed form, `[notes](<C:\Users\sam\My Notes\a.md>)`, is the one spelling
 * that keeps the spaces, and it reads the backslashes the same way the bare one
 * does.
 *
 * Only a destination that starts like an absolute path (a drive, a share, `/`,
 * `~/`, or `file:`) is rewritten, and only when it has no title after it, so
 * prose in parentheses after a bracketed phrase stays prose. Fenced code and
 * inline code are left as written.
 */

// One level of balanced parentheses, as in `Photos (2)`, and nothing that
// could end the destination or start a bracketed one.
const DESTINATION = String.raw`(?:[^()<>\n]|\([^()<>\n]*\))+`;
const PATH_START = String.raw`(?:[A-Za-z]:[\\/]|\\\\|/|~/|file:)`;
const LINK = new RegExp(String.raw`\]\((${PATH_START}${DESTINATION})\)`, "g");

// A destination followed by a title, `(/a/b "Title")`, is already valid.
const TITLE_AT_END = /\s(?:"[^"]*"|'[^']*'|\([^()]*\))\s*$/;

const bracketLinks = (text: string) =>
  text.replace(LINK, (whole, destination: string) =>
    /\s/.test(destination.trim()) && !TITLE_AT_END.test(destination)
      ? `](<${destination.trim()}>)`
      : whole,
  );

// Inline code spans on one line, whose contents are shown as written.
const CODE_SPAN = /(`+).*?\1/g;

const bracketOutsideCodeSpans = (text: string) => {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    out += bracketLinks(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + bracketLinks(text.slice(last));
};

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export function bracketPathLinkDestinations(markdown: string): string {
  if (!markdown.includes("](")) {
    return markdown;
  }
  const lines = markdown.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (prose.length > 0) {
      out.push(bracketOutsideCodeSpans(prose.join("\n")));
      prose = [];
    }
  };
  for (const line of lines) {
    const opener = FENCE_OPEN.exec(line)?.[1];
    if (fence === undefined) {
      if (opener === undefined) {
        prose.push(line);
        continue;
      }
      flush();
      fence = opener;
      out.push(line);
      continue;
    }
    out.push(line);
    if (
      opener !== undefined &&
      opener[0] === fence[0] &&
      opener.length >= fence.length &&
      line.trim() === opener
    ) {
      fence = undefined;
    }
  }
  flush();
  return out.join("\n");
}
