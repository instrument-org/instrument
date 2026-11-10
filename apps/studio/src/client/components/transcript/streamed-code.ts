/**
 * The most of a stream's words a card colors. Past it the words show plain,
 * so a long stream costs nothing to color. A step carries at most the last
 * 1500 characters of a file being written, so this is a guard.
 */
export const STREAMED_CODE_MAX_CHARS = 4000;

/** The lines of a stream already colored, which keep their colors. */
export interface ColoredLines {
  html: readonly string[];
  lines: readonly string[];
}

/**
 * Code still arriving as line spans, colored so nothing already shown changes
 * color as more arrives: each line is colored once, when it is complete, and
 * keeps that markup while it stays in the words, however the words' start
 * moves as their window slides on. The line still arriving shows plain.
 * Undefined past {@link STREAMED_CODE_MAX_CHARS}, for the words to show plain.
 */
export function streamedCode(
  previous: ColoredLines | undefined,
  text: string,
  {
    highlight,
    plain,
  }: {
    /** The code's lines as spans, one per line. */
    highlight: (code: string) => string[];
    plain: (line: string) => string;
  },
): { colored: ColoredLines; spans: string[] } | undefined {
  if (text.length > STREAMED_CODE_MAX_CHARS) {
    return undefined;
  }
  const end = text.lastIndexOf("\n");
  const lines = end === -1 ? [] : text.slice(0, end).split("\n");
  const arriving = text.slice(end + 1);
  const colored = coloredLines(previous, lines, highlight);
  return { colored, spans: [...colored.html, plain(arriving)] };
}

function coloredLines(
  previous: ColoredLines | undefined,
  lines: readonly string[],
  highlight: (code: string) => string[],
): ColoredLines {
  const kept = previous ? previous.html.slice(overlapAt(previous, lines)) : [];
  if (previous && kept.length === lines.length) {
    return kept.length === previous.html.length
      ? previous
      : { html: kept, lines };
  }
  if (lines.length === 0) {
    return { html: [], lines };
  }
  // The new lines are colored with all the words before them, as the file
  // reads them, and the ones already shown keep what they had.
  const fresh = highlight(lines.join("\n")).slice(kept.length);
  return { html: [...kept, ...fresh], lines };
}

/**
 * Where in the previous lines the new ones carry on from: the first line
 * from which every previous line is the same as the new one at its place.
 * Past the end when nothing carries over.
 */
function overlapAt(previous: ColoredLines, lines: readonly string[]): number {
  const { lines: before } = previous;
  for (let start = 0; start < before.length; start++) {
    if (
      before.length - start <= lines.length &&
      before.slice(start).every((line, index) => line === lines[index])
    ) {
      return start;
    }
  }
  return before.length;
}
