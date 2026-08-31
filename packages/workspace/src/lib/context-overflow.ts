import { type SessionMessage } from "../schemas/session/message";

/**
 * Whether a provider that refused the last request for size should be answered
 * by resetting the window.
 *
 * A refusal is the one piece of evidence about a context window that outranks
 * our own arithmetic. Everything else the budget reads is a count compared to a
 * number a provider advertised; this is the provider refusing the actual bytes.
 * It is therefore the answer for every case the arithmetic cannot reach: a
 * model whose window was never reported, a window reported larger than it is,
 * and a count carried over from a model that is no longer answering.
 *
 * Bounded to one reset per refusal, because a reset that did not fix it is
 * evidence that resetting is not the fix. Without the bound a task whose
 * irreducible parts exceed the window resets on every turn, spending another
 * slice of history each time on a request that was never going to be accepted.
 * The bound lifts as soon as a turn is counted, so a session that recovers can
 * be rescued again later.
 *
 * Read backward to the newest assistant turn rather than off the last message,
 * because a turn is assembled after the user's next message has been stored, so
 * the failure being asked about is never the final entry.
 *
 * `classifyProviderError` already produces this verdict on the way in and
 * `SessionMessage` already stores it, so nothing here re-reads a provider
 * payload or grows a second opinion about what an overflow looks like.
 */
export function contextOverflowNeedsRollover(
  messages: readonly SessionMessage.WithParts[],
): boolean {
  let resetAlreadyTried = false;
  let refused: boolean | undefined;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (message.parts.some((part) => part.type === "data-contextRollover")) {
      resetAlreadyTried = true;
    }

    if (message.role !== "assistant") {
      continue;
    }

    refused ??= refusedForSize(message);

    // A turn the provider counted is a turn it accepted, which ends the run of
    // failures this is measuring. Anything older belongs to a difficulty the
    // session already came back from.
    if (message.metadata.usage?.inputTokens !== undefined) {
      break;
    }
  }

  return refused === true && !resetAlreadyTried;
}

function refusedForSize(message: SessionMessage.AssistantWithParts): boolean {
  const error = message.metadata.error;

  // Only the two kinds a provider produces carry a classification, and a turn
  // that ended any other way is a turn that was not refused.
  return (
    (error?.kind === "api-call" || error?.kind === "unknown") &&
    error.classification === "context-overflow"
  );
}
