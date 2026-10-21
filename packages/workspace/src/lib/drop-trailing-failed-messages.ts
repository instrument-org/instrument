import { type SessionMessage } from "../schemas/session/message";

/**
 * Drop the assistant messages at the end of a session that only recorded a
 * failure.
 *
 * A request is built from everything stored, so a turn that adds no new user
 * message -- the in-loop retry after a throttle, or the user asking for the
 * failed turn again -- sends the failed attempt back as the opening of the
 * reply the model is being asked to write. What that attempt holds is a step
 * that never finished: a sentence cut in half, reasoning with no conclusion, a
 * tool call that was never executed. Continuing from it asks the model to build
 * on nothing, and a provider that refuses a pre-written assistant turn while
 * extended thinking is on rejects the whole request instead.
 *
 * Only the tail goes, and only failures. The same message in the middle of a
 * session is followed by whatever the user said next, which is the context that
 * explains what they were reacting to.
 */
export function dropTrailingFailedMessages(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  let end = messages.length;
  while (end > 0) {
    const message = messages[end - 1];
    if (message?.role !== "assistant" || !message.metadata.error) {
      break;
    }
    end--;
  }

  return end === messages.length ? messages : messages.slice(0, end);
}

/**
 * Drop each failed attempt at a step that a retry then finished.
 *
 * The retry was sent without the attempt (`dropTrailingFailedMessages`), so
 * the reply it finished follows the step's input directly, and that is the
 * conversation the model had. Sending the attempt between them afterwards
 * puts a reply in front of every later request that no request ever showed
 * the model, two assistant turns in a row, and a model keeping its own copy of
 * the conversation (a Claude account's Claude Code) finds what it saw changed.
 *
 * A failure is retried when the next message that is not another failure is
 * a finished reply rather than the user's. A reply the user stopped is not a
 * failure here: the model wrote it, and a turn after it may build on it.
 */
export function dropRetriedFailedMessages(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  const retried = new Set<SessionMessage.WithParts>();
  let attempts: SessionMessage.WithParts[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      attempts = [];
    } else if (
      message.metadata.error &&
      message.metadata.error.kind !== "aborted"
    ) {
      attempts.push(message);
    } else if (!message.metadata.error && message.metadata.finishedAt) {
      for (const attempt of attempts) {
        retried.add(attempt);
      }
      attempts = [];
    } else {
      attempts = [];
    }
  }

  return retried.size === 0
    ? messages
    : messages.filter((message) => !retried.has(message));
}
