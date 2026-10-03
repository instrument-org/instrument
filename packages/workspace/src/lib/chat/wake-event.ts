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
