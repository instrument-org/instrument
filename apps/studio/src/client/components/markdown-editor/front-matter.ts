// A Markdown file's front matter as text: found at the top of the file, taken
// apart into its fences and what they hold, and edited a line at a time so
// every line nobody changed keeps its bytes.

/** Front matter at the very top of a file, fences and all. */
const FRONT_MATTER =
  /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Front matter by its parts: the opening fence, what it holds, and the closing fence. */
const FENCES =
  /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n)?)$/;

/**
 * Sets one top-level `key: value` in front matter, rewriting only its line
 * (or adding one at the end); every other line keeps its bytes. A value YAML
 * would read as something else is written quoted.
 */
export function setFrontMatterField(fm: string, key: string, value: string) {
  const { close, inner, nl, open } = splitFences(fm || "---\n\n---\n");
  const lines = inner ? inner.split(/\r?\n/) : [];
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  // The line keeps the style it was written in: message fields are read as
  // their line's text, so an agent's unquoted `subject: Re: invoice` stays
  // unquoted. Only a value that would read as other YAML is quoted.
  const wasQuoted = /^[^:]*:\s*["']/.test(lines[at] ?? "");
  const needsQuotes = wasQuoted || /^["'[{|>&*!%@`#]|^\s|\s$/.test(value);
  const line = `${key}: ${needsQuotes ? JSON.stringify(value) : value}`;
  if (at === -1) {
    lines.push(line);
  } else {
    lines[at] = line;
  }
  return open + lines.join(nl) + close;
}

/** Front matter taken apart: its fences, and what is between them. */
export function splitFences(fm: string) {
  const parts = FENCES.exec(fm);
  const inner = parts?.[2] ?? "";
  return {
    close: parts?.[3] ?? "\n---\n",
    inner,
    nl: inner.includes("\r\n") ? "\r\n" : "\n",
    open: parts?.[1] ?? "---\n",
  };
}

/** A file's text as its front matter (empty when it has none) and the body after it. */
export function splitFrontMatter(text: string): { body: string; fm: string } {
  const m = FRONT_MATTER.exec(text);
  return m
    ? { body: text.slice(m[0].length), fm: m[0] }
    : { body: text, fm: "" };
}
