// What a message quotes, kept as the text it is: Markdown quotes at the top,
// each a run of `> ` lines, a blank line between them and before the words.

/** The quotes a message opens with, oldest first, and the words after them. */
export function splitLeadingQuotes(text: string): {
  quotes: string[];
  words: string;
} {
  const quotes: string[] = [];
  let lines = text.split("\n");
  while (lines[0] !== undefined && /^> \S/.test(lines[0])) {
    const end = lines.findIndex((line) => !/^>(?: |$)/.test(line));
    // Words right under a quote read as more of it in Markdown, so it isn't
    // one set apart from them.
    if (end !== -1 && lines[end] !== "") {
      break;
    }
    quotes.push(
      lines
        .slice(0, end === -1 ? undefined : end)
        .map((line) => line.slice(2))
        .join("\n"),
    );
    lines = end === -1 ? [] : lines.slice(end + 1);
  }
  return { quotes, words: lines.join("\n") };
}

/** A message's text with `quotes` above `words`. */
export function joinLeadingQuotes(
  quotes: readonly string[],
  words: string,
): string {
  return [
    ...quotes.map((quote) =>
      quote
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n"),
    ),
    words,
  ].join("\n\n");
}
