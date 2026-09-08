import { differenceInMinutes } from "date-fns";
import ms from "ms";
import { ok, safeTry } from "neverthrow";
import { alphabetical } from "radashi";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { Store } from "./store";

/**
 * How long the user has to be away before the next thing they write is treated
 * as coming back rather than carrying on.
 *
 * An hour, because the only thing the note changes is whether the model offers
 * an unstarted promise in a sentence or silently acts on it, and being asked
 * once after lunch costs less than a task nobody wanted. Below this the
 * conversation is still the same sitting, gaps for a meeting or a coffee
 * included.
 */
const AWAY_AFTER_MS = ms("1 hour");

/**
 * Reports how long the user was gone, on the first message they send after a
 * long silence in a channel.
 *
 * The session context states the date the session began and nothing states the
 * time, so without this a gap of twenty seconds and a gap of a day reach the
 * model identically and it answers a day-old message as if it were still mid
 * sentence. The date correction is not this signal: it fires on a calendar
 * rollover, which is neither necessary (a whole day can pass inside one date)
 * nor sufficient (a session running through midnight crosses one in minutes).
 *
 * Measured only against messages the user actually sent. A task finishing wakes
 * the orchestrator with a `user` message of its own, and counting those would
 * report three minutes of silence across a night where the user said nothing.
 *
 * Returns undefined when the user has not written in this channel before, and
 * on every message inside the window.
 */
export function detectMessageGap({
  messageId,
  sentAt,
  sessionId,
  signal,
  taskId,
}: {
  messageId: StoreId.Message;
  /** When the message being assembled was sent, so the part matches its message. */
  sentAt: Date;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const messages = yield* Store.getMessagesWithParts(
        { sessionId, taskId },
        { signal },
      );

      // ulid sorts oldest to newest, and the store makes no ordering promise.
      const previous = alphabetical(
        messages.filter(isFromUser),
        (message) => message.id,
      ).at(-1);
      if (!previous) {
        return ok(undefined);
      }

      const gapMs = sentAt.getTime() - previous.metadata.createdAt.getTime();
      if (gapMs < AWAY_AFTER_MS) {
        return ok(undefined);
      }

      return ok({
        data: {
          minutes: differenceInMinutes(sentAt, previous.metadata.createdAt),
        },
        metadata: {
          createdAt: sentAt,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-messageGap",
      } satisfies SessionMessagePart.Type);
    },
  );
}

/**
 * Whether a stored `user` message is the user speaking.
 *
 * The role is shared with every wake: a task reporting, an app firing an event.
 * What separates them is that the user types or attaches something, while a
 * wake carries one data part and no words. Read as what the user contributed
 * rather than as a list of the wake kinds to skip, so a new kind of wake is
 * silent here without anyone remembering to add it.
 */
function isFromUser(message: SessionMessage.WithParts) {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) =>
        (part.type === "text" && part.text.trim().length > 0) ||
        part.type === "data-attachments",
    )
  );
}
