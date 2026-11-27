import remend from "remend";

// One or two backticks ending the text. Three are a fence, which draws nothing
// until its opening line is whole.
const TRAILING_BACKTICKS = /(?<!`)`{1,2}$/;

// An emphasis or strikethrough marker ending the text with nothing before it
// on its side of a space, which is what makes it an opener: a closer is written
// against the word it closes.
const TRAILING_EMPHASIS_OPENER = /(?<=^|\s)(?:\*{1,3}|_{1,3}|~~)$/;

const backtickCount = (text: string) => text.split("`").length - 1;

/**
 * The block of a message still arriving, without the marker it ends on when
 * that marker opens a code span, bold, italic or strikethrough whose words
 * have not arrived yet.
 *
 * Nothing can close such a marker, so it would be drawn as literal characters,
 * which the styled words replace one token later. Backticks that close a code
 * span stay: `remend` adds a closing backtick to the text before them exactly
 * when a span is open there.
 */
export function withoutArrivingInlineOpener(block: string): string {
  const emphasis = TRAILING_EMPHASIS_OPENER.exec(block);
  if (emphasis) {
    return block.slice(0, emphasis.index);
  }
  const backticks = TRAILING_BACKTICKS.exec(block);
  if (!backticks) {
    return block;
  }
  const before = block.slice(0, backticks.index);
  return backtickCount(remend(before)) === backtickCount(before)
    ? before
    : block;
}
