/**
 * How a reply's words come on screen while they stream: at a pace of their
 * own, set by how far behind the stream they are, rather than in the bursts
 * the network delivers them in. Plain functions, so a run of ticks is the same
 * every time it is replayed.
 */

/** Where a reveal stands: how many characters are out, and how fast it is moving. */
export interface RevealState {
  /** Characters revealed, fractional between ticks. */
  shown: number;
  /** Characters a second, eased toward the pace the backlog asks for. */
  velocity: number;
}

/** The slowest a reveal moves while there is anything left to show. */
export const MIN_CHARS_PER_SECOND = 90;

/** How far behind the stream the reveal aims to sit while it streams. */
const STREAMING_LAG_MS = 280;

/** How quickly what is left is shown once the stream has ended. */
const FINISHED_LAG_MS = 140;

/** How long the pace takes to come most of the way to a new target. */
const EASE_MS = 120;

/**
 * One tick: the pace eases toward what the backlog asks for, and the reveal
 * moves on by it. The backlog is cleared in about a lag's time at any stream
 * speed, so a fast model is never held back and a slow one never stutters.
 */
export function advance(
  state: RevealState,
  length: number,
  dtMs: number,
  isStreaming: boolean,
): RevealState {
  const backlog = length - state.shown;
  if (backlog <= 0 || dtMs <= 0) {
    return { shown: Math.min(state.shown, length), velocity: state.velocity };
  }
  const lag = isStreaming ? STREAMING_LAG_MS : FINISHED_LAG_MS;
  const wanted = Math.max(MIN_CHARS_PER_SECOND, (backlog * 1000) / lag);
  const ease = 1 - Math.exp(-dtMs / EASE_MS);
  // Speeding up eases in; once the stream has ended the pace never drops
  // below what the rest needs, so the last words do not crawl.
  const velocity =
    !isStreaming && wanted < state.velocity
      ? state.velocity
      : state.velocity + (wanted - state.velocity) * ease;
  const shown = Math.min(length, state.shown + (velocity * dtMs) / 1000);
  return { shown, velocity };
}

/** A table's line: it starts with a pipe, indentation aside. */
const TABLE_LINE = /^ {0,3}\|/;

/** A table's divider line, the one under its header. */
const TABLE_DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * The longest prefix of `text` no longer than `upTo` that is safe to draw:
 * it ends at a word's end, and a table in it has whole rows only, starting
 * once its header and divider are both there, so a table never lays out as
 * paragraphs first and then snaps into a grid. While the text is still
 * streaming its end is held to the same rules, since its last word and row may
 * be cut short.
 */
export function revealCut(
  text: string,
  upTo: number,
  isStreaming = false,
): number {
  if (upTo >= text.length && !isStreaming) {
    return text.length;
  }
  if (upTo <= 0) {
    return 0;
  }
  let cut = Math.min(upTo, text.length);
  // Back to the end of the last whole word.
  if (!/\s/.test(text[cut] ?? "")) {
    let at = cut - 1;
    while (at >= 0 && !/\s/.test(text[at] ?? "")) {
      at -= 1;
    }
    cut = Math.max(0, at);
  }
  const lineStart = text.lastIndexOf("\n", cut - 1) + 1;
  const lineEnd = text.indexOf("\n", lineStart);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  if (!TABLE_LINE.test(line)) {
    return cut;
  }
  // Inside a table: find where it starts, and how many of its lines are whole.
  let tableStart = lineStart;
  while (tableStart > 0) {
    const previousStart = text.lastIndexOf("\n", tableStart - 2) + 1;
    const previous = text.slice(previousStart, tableStart - 1);
    if (!TABLE_LINE.test(previous)) {
      break;
    }
    tableStart = previousStart;
  }
  // Lines of the table that end before the cut, newline included.
  const whole = text.slice(tableStart, lineStart).split("\n").slice(0, -1);
  const hasHead = whole.length >= 2 && TABLE_DIVIDER.test(whole[1] ?? "");
  return hasHead ? lineStart : tableStart;
}
