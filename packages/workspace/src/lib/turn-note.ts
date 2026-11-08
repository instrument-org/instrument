import { TURN_NOTE, LENGTH_NOTE } from "../model-text/request/turn-notes";
import { joinedMidTurn } from "./chat/mid-turn";
import { givenEndOfTurnNote } from "./end-of-turn-checks";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { sessionRole } from "./chat/children";
import { ChatReads } from "./chat-reads";
import { isTypedByUser } from "./typed-by-user";

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
}): Promise<
  undefined | { kind: "correction" | "output-limit" | "turn"; text: string }
> {
  const messages = await ChatReads.modelHistory({ chatId, sessionId });
  if (messages.isErr()) {
    return undefined;
  }
  if (cutOffAtOutputLimit(messages.value)) {
    return { kind: "output-limit", text: LENGTH_NOTE };
  }
  const correction = givenEndOfTurnNote({
    messages: messages.value,
    sessionId,
  });
  if (correction !== undefined) {
    return { kind: "correction", text: correction };
  }
  return sessionRole(chatId, sessionId) === "chat" &&
    opensTypedTurn(messages.value)
    ? { kind: "turn", text: TURN_NOTE }
    : undefined;
}
