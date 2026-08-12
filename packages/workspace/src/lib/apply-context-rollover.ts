import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";

/**
 * The history a task continues from after its context window was reset.
 *
 * A rollover keeps what the user said and discards what the model said. The
 * user's words are the part that cannot be reconstructed: a constraint given
 * forty turns ago is still binding, and a summary of it is a paraphrase we
 * chose to trust. Assistant turns are dropped instead, which costs the model's
 * own discovered state and buys two things worth more at this point. The
 * transcript stops growing, and a history with no tool calls in it cannot
 * orphan a tool result, so the pairing that every provider rejects is
 * impossible here rather than defended against.
 *
 * Applied as a view over messages that all remain on disk. Nothing is deleted,
 * so a boundary can be read, shown, or undone later.
 */

/**
 * Characters of user text carried across a rollover.
 *
 * Bounded because the whole point is to produce a history that fits, and an
 * unbounded carry can exceed the window on its own: one pasted file in a user
 * message would roll over into a history just as unsendable as the one it
 * replaced, and the task would reset on every turn without ever moving.
 *
 * Characters rather than tokens on purpose. This is a selection heuristic
 * choosing between messages, where being off by a fraction costs one message at
 * the margin. It is deliberately not the number anything triggers on: those
 * read the provider's reported usage, so the decision to act and the decision
 * about what to keep never disagree about the same units.
 */
const RETAINED_USER_TEXT_CHARACTERS = 40_000;

export function applyContextRollover({
  messages,
  rolledOverAfterMessageId,
}: {
  messages: readonly SessionMessage.WithParts[];
  rolledOverAfterMessageId: StoreId.Message | undefined;
}): SessionMessage.WithParts[] {
  if (rolledOverAfterMessageId === undefined) {
    return [...messages];
  }

  const boundary = messages.findIndex(
    (message) => message.id === rolledOverAfterMessageId,
  );

  // A boundary naming a message this session no longer has is a boundary we
  // cannot place. Carrying the whole history is the safe reading: it risks the
  // request being too large, which the caller already handles, rather than
  // silently discarding turns the user can still see.
  if (boundary === -1) {
    return [...messages];
  }

  const withinWindow = messages.slice(boundary + 1);
  const retained = retainNewestUserMessages(messages.slice(0, boundary + 1));

  return [...retained, ...withinWindow];
}

/**
 * User messages from the reset portion, oldest first, newest kept first.
 *
 * Walking backward means the budget is spent on what the user said most
 * recently, and an old message dropped for room is dropped whole rather than
 * cut in half.
 */
function retainNewestUserMessages(
  messages: readonly SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  const retained: SessionMessage.WithParts[] = [];
  let budget = RETAINED_USER_TEXT_CHARACTERS;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    const size = userTextLength(message);
    if (size > budget) {
      break;
    }

    budget -= size;
    retained.unshift(message);
  }

  return retained;
}

function userTextLength(message: SessionMessage.WithParts): number {
  let total = 0;
  for (const part of message.parts) {
    if (part.type === "text") {
      total += part.text.length;
    }
  }
  return total;
}
