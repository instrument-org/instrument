const OPENING_TAGS = /^<pre\b[^>]*>\s*<code\b[^>]*>/;
const CLOSING_TAGS = /<\/code>\s*<\/pre>\s*$/;

/**
 * Shiki's rendered block, cut into one `<span class="line">` per source line.
 *
 * The highlighter returns a single `<pre><code>` block already split on
 * newlines, so every element but the first and last is a whole line on its own.
 * Peeling the wrapper tags off those two makes the array index-aligned with
 * `content.split("\n")`, which is what lets a virtualizer render highlighted
 * line 8,000 without the 7,999 before it.
 *
 * Returns undefined when the block does not have the expected wrapper, so a
 * change in the highlighter's output shows up as unhighlighted text rather than
 * as a stray `<pre>` tag rendered into the middle of the transcript.
 */
export function highlightedLines(
  block: string[] | undefined,
): string[] | undefined {
  const first = block?.[0];
  const last = block?.at(-1);
  if (
    block === undefined ||
    first === undefined ||
    last === undefined ||
    !OPENING_TAGS.test(first) ||
    !CLOSING_TAGS.test(last)
  ) {
    return undefined;
  }

  const lastIndex = block.length - 1;
  return block.map((line, index) => {
    const opened = index === 0 ? line.replace(OPENING_TAGS, "") : line;
    // Both wrappers sit on the same element when the block is one line long.
    return index === lastIndex ? opened.replace(CLOSING_TAGS, "") : opened;
  });
}
