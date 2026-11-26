/**
 * Rewrites the ways a reply writes TeX math that `remark-math` does not read
 * into the ones it does, so math is drawn however the agent delimited it:
 *
 * - `$3x - 12 = 2x + 5$` by Pandoc's rule: the opening `$` has a character
 *   other than a space after it, the closing one has one before it and no
 *   digit after it, and no `$` comes between. So `$100 and $200`, `$5-$10`
 *   and `costs $5 or $10` stay text, which is why the parser's own single
 *   dollar is left off. Read as `$$…$$`, which the parser draws in the line.
 * - `\(…\)` in a line, as `$$…$$`.
 * - `$$…$$` or `\[…\]` alone on a line, and `\[` and `\]` on lines of their
 *   own around math, as a display block between `$$` lines. `\[` inside a
 *   sentence is an escaped bracket and stays one.
 *
 * Fenced code, inline code, a `$` escaped with a backslash and a display
 * block's own lines are left as written.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("$") && !markdown.includes("\\")) {
    return markdown;
  }
  const out: string[] = [];
  let fence: string | undefined;
  // The line that closes the display block this line is in.
  let display: "$$" | "\\]" | undefined;
  for (const line of markdown.split("\n")) {
    if (fence !== undefined) {
      out.push(line);
      const closer = FENCE_OPEN.exec(line)?.[1];
      if (
        closer !== undefined &&
        closer[0] === fence[0] &&
        closer.length >= fence.length &&
        line.trim() === closer
      ) {
        fence = undefined;
      }
      continue;
    }
    const [, prefix = "", rest = ""] = /^([ \t>]*)(.*)$/.exec(line) ?? [];
    if (display !== undefined) {
      if (display === "\\]" && /\\\]\s*$/.test(rest)) {
        const before = rest.replace(/\\\]\s*$/, "");
        if (before.trim() !== "") {
          out.push(prefix + before);
        }
        out.push(`${prefix}$$`);
        display = undefined;
      } else {
        out.push(line);
        if (display === "$$" && rest.trim() === "$$") {
          display = undefined;
        }
      }
      continue;
    }
    const opener = FENCE_OPEN.exec(line)?.[1];
    if (opener !== undefined) {
      fence = opener;
      out.push(line);
      continue;
    }
    if (rest.trim() === "$$") {
      display = "$$";
      out.push(line);
      continue;
    }
    const whole = DISPLAY_LINE.exec(rest.trim());
    const inner = whole?.[1] ?? whole?.[2];
    if (inner !== undefined && inner.trim() !== "") {
      out.push(`${prefix}$$`, prefix + inner.trim(), `${prefix}$$`);
      continue;
    }
    const opened = /^\\\[(.*)$/.exec(rest.trim());
    if (opened && !opened[1]?.includes("\\]")) {
      out.push(`${prefix}$$`);
      if (opened[1]?.trim()) {
        out.push(prefix + opened[1].trim());
      }
      display = "\\]";
      continue;
    }
    out.push(prefix + outsideCode(rest, inlineMath));
  }
  return out.join("\n");
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

// A line that is display math whole: `$$…$$` or `\[…\]`.
const DISPLAY_LINE = /^(?:\$\$((?:(?!\$\$).)+)\$\$|\\\[((?:(?!\\\]).)+)\\\])$/;

// Inline code, whose contents are shown as written, and math already in
// double dollars, which the parser reads as it is.
const LEFT_AS_WRITTEN = /(`+).*?\1|\$\$.+?\$\$/g;

const outsideCode = (text: string, rewrite: (text: string) => string) => {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(LEFT_AS_WRITTEN)) {
    out += rewrite(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + rewrite(text.slice(last));
};

/** Whether the character at `index` is escaped by the backslashes before it. */
const isEscaped = (text: string, index: number) => {
  let count = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at -= 1) {
    count += 1;
  }
  return count % 2 === 1;
};

const inlineMath = (text: string) => parenthesizedMath(singleDollarMath(text));

/** `\(…\)` as `$$…$$`. */
const parenthesizedMath = (text: string) =>
  text.replaceAll(/\\\((.+?)\\\)/g, (whole, inner: string, at: number) =>
    isEscaped(text, at) || inner.trim() === "" ? whole : `$$${inner}$$`,
  );

/** `$…$` by Pandoc's rule, as `$$…$$`. */
const singleDollarMath = (text: string) => {
  const dollars = [...text.matchAll(/\$/g)]
    .map((match) => match.index)
    .filter((index) => !isEscaped(text, index));
  const spans: [number, number][] = [];
  for (let at = 0; at < dollars.length - 1; at += 1) {
    const open = dollars[at] ?? 0;
    const close = dollars[at + 1] ?? 0;
    const after = text[open + 1] ?? "";
    const before = text[close - 1] ?? "";
    const next = text[close + 1] ?? "";
    if (
      close > open + 1 &&
      !/\s/.test(after) &&
      !/\s/.test(before) &&
      !/\d/.test(next)
    ) {
      spans.push([open, close]);
      at += 1;
    }
  }
  let out = "";
  let last = 0;
  for (const [open, close] of spans) {
    out += `${text.slice(last, open)}$$${text.slice(open + 1, close)}$$`;
    last = close + 1;
  }
  return out + text.slice(last);
};
