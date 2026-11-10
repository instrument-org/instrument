import { type StoreId } from "../../schemas/store-id";
import { type TranscriptMessage } from "./transcript-message";
import { isTurnFolded, type Turn, turnsOf } from "./turns-of";

/** How many times a search's words are in one turn, by the turn's id. */
export interface TurnMatches {
  count: number;
  id: StoreId.Message;
}

/**
 * Where a chat's find has matches in a session, turn by turn, oldest first:
 * what the reader can search before the turns are loaded to draw. Only the
 * words a turn shows with its work folded count: the person's message (or
 * what the chat wrote to a task) and the replies outside the fold. A reply's
 * Markdown is read without its marks, so the count is close to what the
 * drawn turn has, which is what the find counts once it is loaded.
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
    const count = shownWords(turn).reduce(
      (sum, words) => sum + countMatches(words, query),
      0,
    );
    return count > 0 ? [{ count, id: turn.id }] : [];
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

function shownWords(turn: Turn): string[] {
  // A turn read back is long finished, so it is folded if it folds at all.
  const isFolded = isTurnFolded(turn, Number.POSITIVE_INFINITY);
  return [
    turn.opener?.text?.text ?? "",
    turn.opener?.fromChat?.text ?? "",
    ...turn.rows.flatMap((row) =>
      row.kind === "text" && !(isFolded && turn.foldedRowIds.has(row.id))
        ? [withoutMarks(row.part.text)]
        : [],
    ),
  ];
}

/** Markdown's marks taken out, roughly as the reply draws without them. */
function withoutMarks(markdown: string): string {
  return markdown
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\*\*|__|~~|`/g, "")
    .replaceAll(/^ {0,3}(?:#{1,6} +|> ?)/gm, "");
}
