import { joinedMidTurn } from "./chat/mid-turn";
import { givenEndOfTurnNote } from "./end-of-turn-checks";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { sessionRole } from "./chat/children";
import { ChatReads } from "./chat-reads";
import { systemNote } from "./system-note";
import { isTypedByUser } from "./typed-by-user";

/**
 * What the first step of a chat's turn is sent with when the user typed the
 * message it answers: a line to them before any work, and then quiet until
 * the outcome. A note rather than a prompt rule, since it is read where the
 * turn starts, and placed after the cache breakpoints for that one request,
 * never stored. A task gets none: nobody reads its lines as they come.
 */
export const TURN_NOTE = systemNote`
  Before using any tool, tell the user in a few words what you are doing ("Reading the lease."), the work rather than their request said back, then nothing more until the outcome. If no tool is needed, just answer.
`;

/**
 * Whether the next step opens a turn the user typed: the turn's message is
 * the user's own words, not a note the harness wrote, nor one that joined a
 * turn already under way, and no step of the turn has run yet. A failed step
 * does not count, since its retry is still the turn's first.
 */
export function opensTypedTurn(messages: SessionMessage.WithParts[]): boolean {
  const start = messages.findLastIndex((message) => message.role === "user");
  const opener = messages[start];
  if (opener === undefined || !isTypedByUser(opener) || joinedMidTurn(opener)) {
    return false;
  }
  return !messages
    .slice(start + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.metadata.error === undefined &&
        !message.metadata.synthetic,
    );
}

/**
 * What a step is sent with when the model ran out of room to write: its reply
 * stops mid-word, and the step that follows is the rest of it. The note says
 * so, because a model handed its own unfinished text with nothing else will
 * either start over or answer as though it had finished.
 */
const LENGTH_NOTE = systemNote`
  Your last reply was cut off at the output limit, mid-word. Carry on from exactly where it stops, without repeating what is already there and without starting over. Write less at a time.
`;

/**
 * Whether the next step carries on a reply the output limit cut off: the
 * turn's latest message is a step of the agent's that the model stopped
 * writing because it ran out of room.
 */
export function cutOffAtOutputLimit(
  messages: SessionMessage.WithParts[],
): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.metadata.error === undefined &&
    !last.metadata.synthetic &&
    last.metadata.finishReason === "length"
  );
}

/**
 * The note a session's next step carries, read from its stored transcript:
 * `LENGTH_NOTE` on a step that carries on a reply the output limit cut off,
 * the end-of-turn checks' note on the step that corrects a reply failing one
 * (the note `endOfTurnNote` gave when it decided the turn goes on, never
 * judged again), `TURN_NOTE` on the first step of a chat's typed turn,
 * otherwise none.
 */
export async function turnNoteFor({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<string | undefined> {
  const messages = await ChatReads.modelHistory({ chatId, sessionId });
  if (messages.isErr()) {
    return undefined;
  }
  if (cutOffAtOutputLimit(messages.value)) {
    return LENGTH_NOTE;
  }
  const correction = givenEndOfTurnNote({
    messages: messages.value,
    sessionId,
  });
  if (correction !== undefined) {
    return correction;
  }
  return sessionRole(chatId, sessionId) === "chat" &&
    opensTypedTurn(messages.value)
    ? TURN_NOTE
    : undefined;
}
