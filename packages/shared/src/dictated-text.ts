// The one definition of the dictated-text wire form, shared by every side that
// reads or writes it: the composer that marks words a person dictated, the
// transcript and lists that show them as plain words, and the workspace that
// tells the model they were spoken. The composer writes `[words](dictated:)`.
// A `]` or `\` in the words is escaped with a `\`, so the label holds any
// text the person dictated or edited into it.
const DICTATED_PATTERN = /\[((?:\\.|[^\]\\\n])+)\]\(dictated:\)/g;

const unescape = (label: string) => label.replaceAll(/\\(.)/g, "$1");

export type DictatedTextSegment = { dictated: boolean; text: string };

/** The wire form of words someone dictated, a token per line. */
export function dictatedToken(text: string) {
  return text
    .split("\n")
    .map((line) =>
      line ? `[${line.replaceAll(/[\\\]]/g, "\\$&")}](dictated:)` : line,
    )
    .join("\n");
}

/** A line split into dictated and typed runs, in order, for the composer to mark. */
export function splitDictatedText(line: string): DictatedTextSegment[] {
  const segments: DictatedTextSegment[] = [];
  let last = 0;
  for (const match of line.matchAll(DICTATED_PATTERN)) {
    if (match.index > last) {
      segments.push({ dictated: false, text: line.slice(last, match.index) });
    }
    segments.push({ dictated: true, text: unescape(match[1] ?? "") });
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    segments.push({ dictated: false, text: line.slice(last) });
  }
  return segments;
}

/** The words as a person reads them: each dictated run as its plain words. */
export function stripDictatedMarks(text: string) {
  return text.replaceAll(DICTATED_PATTERN, (_, label: string) =>
    unescape(label),
  );
}

/**
 * The words as the model reads them: each dictated run wrapped in
 * `<dictated>`, which its instructions say was spoken and transcribed, so a
 * word that makes no sense there may be one that sounds like it.
 */
export function renderDictatedForModel(text: string) {
  return text.replaceAll(
    DICTATED_PATTERN,
    (_, label: string) => `<dictated>${unescape(label)}</dictated>`,
  );
}
