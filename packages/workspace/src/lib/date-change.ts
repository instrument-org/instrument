import { ok, safeTry } from "neverthrow";
import { alphabetical } from "radashi";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { contextDateKey } from "./context-date";
import { getCurrentDate } from "./get-current-date";
import { Store } from "./store";

/**
 * Reports the local date on the first message of a day the session has not seen
 * yet, so a conversation that runs past midnight is not left reading the date
 * its context was written on.
 *
 * One clock read at send time, compared against the session's own record: the
 * session-context message it started from, or the latest correction since. No
 * timer, and nothing is rewritten -- the correction is a new part on the message
 * being sent, which is what keeps the request prefix in front of it byte-stable.
 *
 * Returns undefined while the session has no context message yet (the first
 * message of a task, whose baseline is written moments later with today's date)
 * and on every message sent on a day already recorded.
 */
export function detectDateChange({
  messageId,
  sessionId,
  signal,
  taskId,
}: {
  messageId: StoreId.Message;
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
      const baseline = alphabetical(
        messages.filter((message) => message.role === "session-context"),
        (message) => message.id,
      ).at(0);
      if (!baseline) {
        return ok(undefined);
      }

      const corrections = alphabetical(
        messages
          .flatMap((message) => message.parts)
          .filter(
            (
              part,
            ): part is SessionMessagePart.DataPart & {
              type: "data-dateChange";
            } => part.type === "data-dateChange",
          ),
        (part) => part.metadata.id,
      );
      const recorded =
        corrections.at(-1)?.data.date ??
        contextDateKey(baseline.metadata.createdAt);

      const today = contextDateKey(getCurrentDate());
      if (today === recorded) {
        return ok(undefined);
      }

      return ok({
        data: { date: today },
        metadata: {
          createdAt: getCurrentDate(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-dateChange",
      } satisfies SessionMessagePart.Type);
    },
  );
}
