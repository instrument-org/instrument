import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import {
  sanitizeSurrogates,
  truncateWithoutSplitting,
} from "./sanitize-model-text";

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

/**
 * Model turns that must have accumulated before a reset is worth doing.
 *
 * A rollover only reclaims assistant turns, so when there are barely any to
 * reclaim it costs a rebuilt prefix and returns nothing. Without this floor a
 * task whose irreducible parts already fill the window resets on every single
 * step: each reset deletes the work the model just did, the model does it
 * again, and the run burns turns making the same discovery forever. That is not
 * a hypothetical failure mode, it is what a window smaller than the system
 * prompt produces, and the symptom is cost rather than an error.
 *
 * The floor is why this is safe to leave on. In a real window the count is far
 * past it long before the budget runs out, so it only ever binds in the case it
 * exists for.
 */
const MIN_ASSISTANT_TURNS_TO_RECLAIM = 4;

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
 * Whether resetting the window now would actually free anything.
 *
 * Answered against the messages already inside the current window, so it reads
 * as "how much has built up since the last reset" rather than over the whole
 * task.
 */
export function contextRolloverWouldReclaim(
  messagesInWindow: readonly SessionMessage.WithParts[],
): boolean {
  let assistantTurns = 0;
  for (const message of messagesInWindow) {
    if (message.role === "assistant") {
      assistantTurns += 1;
      if (assistantTurns >= MIN_ASSISTANT_TURNS_TO_RECLAIM) {
        return true;
      }
    }
  }
  return false;
}

/**
 * User messages from the reset portion, oldest first, newest kept first.
 *
 * Walking backward means the budget is spent on what the user said most
 * recently, and an old message dropped for room is dropped whole rather than
 * cut in half.
 *
 * The newest one is retained whatever its size, because it is the turn the
 * model is being asked to answer. Dropping it produces a request in which the
 * user said nothing, which the model answers out of the older context instead:
 * it responds to the previous ask rather than the one just made, and nothing in
 * the transcript says why. A cut copy of the request beats no request at all,
 * so an oversized newest message is trimmed to the budget rather than left out.
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
      // Nothing retained yet means this is the newest, which is kept whole or
      // cut but never dropped. An older one that no longer fits ends the walk.
      if (retained.length > 0) {
        break;
      }

      retained.unshift({ ...message, parts: cutTextToBudget(message, budget) });
      budget = 0;
      continue;
    }

    budget -= size;
    retained.unshift(message);
  }

  return retained;
}

/**
 * A message's parts with its text cut down to a character budget.
 *
 * Both ends of the text survive and the middle goes. Which end of a long user
 * turn carries the ask is not knowable here: "here is the log, find the error"
 * and "find the error in the log below" put it at opposite ends of the same
 * message. Keeping one end would decide that for the user and lose the
 * instruction outright half the time, while the payload those instructions
 * wrap around is the part that is bulky and the part the model can ask about.
 *
 * The budget spans the message rather than each part, so text parts before the
 * cut survive whole, text parts after it survive whole, and only the ones the
 * omission runs through are rewritten. Parts that hold no text are untouched.
 */
function cutTextToBudget(
  message: SessionMessage.WithParts,
  budget: number,
): SessionMessagePart.Type[] {
  const total = userTextLength(message);
  const headBudget = Math.ceil(budget / 2);
  const tailStart = total - (budget - headBudget);

  let consumed = 0;

  return message.parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }

    const start = consumed;
    consumed += part.text.length;

    const head = truncateWithoutSplitting(
      part.text,
      Math.max(0, headBudget - start),
    );
    // A tail can open on the low half of a character whose high half was cut
    // away, which is the same broken encoding a naive head cut makes and which
    // providers reject. Dropping halves is what the sanitizer is for.
    const tail = sanitizeSurrogates(
      part.text.slice(part.text.length - Math.max(0, consumed - tailStart)),
    );
    const omitted = part.text.length - head.length - tail.length;

    return omitted <= 0
      ? part
      : { ...part, text: `${head}${omissionMarker(omitted)}${tail}` };
  });
}

/**
 * The line standing where a cut user message's middle used to be.
 *
 * It disclaims itself, because both directions of confusion cost something. A
 * note read as the user speaking becomes an instruction the model follows, and
 * the user's own words read as a note become something it may ignore. Saying
 * whose text this is not settles both, and the count tells the model how much
 * of the message it is answering without.
 */
function omissionMarker(characters: number): string {
  return `\n\n[context rollover omitted ${characters} characters here; this bracketed line is not the user's text]\n\n`;
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
