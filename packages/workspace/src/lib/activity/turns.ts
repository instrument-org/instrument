import { type ActivityRow } from "./schema";

/**
 * How the AI requests gather into turns among what the person did, the one
 * rule Settings › Activity and `instrument activity` both read them by.
 */

/** The longest pause between two requests of one turn. */
export const TURN_GAP_MS = 5 * 60_000;

/** What a request is told apart by when it gathers into a turn. */
type Gathered = Pick<
  ActivityRow,
  "chatId" | "purpose" | "sessionId" | "surface"
>;

/** Whether a request continues a turn: the same chat and session, or with no chat, the same place and purpose. */
function continues(turn: Gathered, request: Gathered) {
  if (turn.chatId !== null || request.chatId !== null) {
    return (
      turn.chatId === request.chatId && turn.sessionId === request.sessionId
    );
  }
  return turn.surface === request.surface && turn.purpose === request.purpose;
}

/**
 * The person's entries and the turns the requests among them make, newest
 * first, from both newest first. The requests of one chat and session
 * gather into a turn while each comes within {@link TURN_GAP_MS} of the next
 * and the person did nothing in between; requests from no chat gather by
 * where they came from and why. A turn's requests are newest first, and it
 * stands where its newest one does.
 */
export function gatherTurns<A, R extends Gathered>(
  newestFirst: readonly ({ at: number } & ({ action: A } | { request: R }))[],
): (
  | { action: A; at: number; kind: "action" }
  | { at: number; kind: "turn"; requests: R[] }
)[] {
  const gathered: (
    | { action: A; at: number; kind: "action" }
    | { at: number; kind: "turn"; requests: R[] }
  )[] = [];
  let open: { oldest: number; requests: R[] }[] = [];
  for (const item of newestFirst) {
    if ("action" in item) {
      open = [];
      gathered.push({ action: item.action, at: item.at, kind: "action" });
      continue;
    }
    const { at, request } = item;
    open = open.filter((each) => each.oldest - at < TURN_GAP_MS);
    const joined = open.find(
      (each) =>
        each.requests[0] !== undefined && continues(each.requests[0], request),
    );
    if (joined) {
      joined.requests.push(request);
      joined.oldest = at;
      continue;
    }
    const requests = [request];
    open.push({ oldest: at, requests });
    gathered.push({ at, kind: "turn", requests });
  }
  return gathered;
}
