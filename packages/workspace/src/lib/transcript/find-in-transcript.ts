import { type StoreId } from "../../schemas/store-id";
import { type TranscriptMessage } from "./transcript-message";
import { isTurnFolded, type Turn, turnsOf } from "./turns-of";

/** How many times a search's words are in one turn, by the turn's id. */
export interface TurnMatches {
  /** Every match, those in its folded work included. */
  count: number;
  /** The matches in the work its Worked row folds, which open it to find them. */
  folded: number;
  id: StoreId.Message;
}

/**
 * Where a chat's find has matches in a session, turn by turn, oldest first:
 * what the reader can search before the turns are loaded to draw, and which
 * folded work to open to draw its matches. What counts is what a turn shows
 * with its Worked row open: the person's message (or what the chat wrote to a
 * task), the replies, and in the work the words the agent wrote, each
 * activity's name and each step's line. Markdown is read without its marks,
 * so the count is close to what the drawn turn has, which is what the find
 * counts once it is loaded.
 */
export function findInTranscript({
  messages,
  query,
  sessionId,
}: {
  messages: readonly TranscriptMessage[];
  query: string;
  sessionId: StoreId.Session;
}): TurnMatches[] {
  if (query === "") {
    return [];
  }
  return turnsOf(messages, { isRunning: false, sessionId }).flatMap((turn) => {
    if (turn.inherited) {
      return [];
    }
    const matches = (words: string[]) =>
      words.reduce((sum, text) => sum + countMatches(text, query), 0);
    const { folded, shown } = turnWords(turn);
    const inFold = matches(folded);
    const count = matches(shown) + inFold;
    return count > 0 ? [{ count, folded: inFold, id: turn.id }] : [];
  });
}

/**
 * How many times `query` is in `text`, ignoring case, matches not
 * overlapping: the way the find in the transcript counts them.
 */
export function countMatches(text: string, query: string): number {
  if (query === "") {
    return 0;
  }
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count++;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

/** The words a turn draws, split by whether its Worked row folds them. */
function turnWords(turn: Turn): { folded: string[]; shown: string[] } {
  // A turn read back is long finished, so it is folded if it folds at all.
  const isFolded = isTurnFolded(turn, Number.POSITIVE_INFINITY);
  const shown = [
    turn.opener?.text?.text ?? "",
    turn.opener?.fromChat?.text ?? "",
  ];
  const folded: string[] = [];
  for (const row of turn.rows) {
    const words =
      row.kind === "text"
        ? [withoutMarks(row.part.text)]
        : row.kind === "activity"
          ? [
              row.title ?? "",
              ...row.steps.map((step) => step.explanation ?? ""),
            ]
          : [];
    (isFolded && turn.foldedRowIds.has(row.id) ? folded : shown).push(...words);
  }
  return { folded, shown };
}

/** Markdown's marks taken out, roughly as the reply draws without them. */
function withoutMarks(markdown: string): string {
  return markdown
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\*\*|__|~~|`/g, "")
    .replaceAll(/^ {0,3}(?:#{1,6} +|> ?)/gm, "");
}
