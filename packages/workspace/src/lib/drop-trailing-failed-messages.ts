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
