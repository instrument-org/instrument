import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

type TaskEvent = SessionMessageDataPart.TaskEventDataPart["events"][number];

/**
 * Whether an event about a task takes the place of one already waiting out
 * the debounce for it. The end of a turn is the news, so a note that the task
 * is still at work never covers one saying it finished: that note was
 * composed before the finish and is stale by the time it arrives.
 */
export function replacesPendingEvent(
  waiting: TaskEvent | undefined,
  incoming: TaskEvent,
): boolean {
  return (
    waiting === undefined ||
    waiting.status === "overdue" ||
    incoming.status !== "overdue"
  );
}

/**
 * Whether a message is a note naming tasks a stop ended without waking the
 * chat: the app's quit cut them off, or the user stopped them. It starts no
 * turn, and reaches the chat's agent with its next one, after relaunch or
 * with the user's next message.
 */
export function isStopNote(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "user" &&
    message.parts.length > 0 &&
    message.parts.every(
      (part) =>
        part.type === "data-taskEvent" &&
        part.data.events.length > 0 &&
        part.data.events.every(
          (event) => event.stoppedBy === "app" || event.stoppedBy === "user",
        ),
    )
  );
}
