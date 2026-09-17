import { err, ok, type Result } from "neverthrow";
import { alphabetical } from "radashi";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { createSession } from "../create-session";
import { type TypedError } from "../errors";
import { Store } from "../store";

/** What a task's agent last wrote in a session, cut at a length when given one and saying so where it stops; whole otherwise. */
export async function lastAssistantText({
  maxLength,
  sessionId,
  taskId,
}: {
  maxLength?: number;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<string | undefined> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return undefined;
  }
  return lastAssistantTextIn(messages.value, maxLength);
}

/** The same words, read from a transcript already in hand. */
export function lastAssistantTextIn(
  messages: SessionMessage.WithParts[],
  maxLength?: number,
): string | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
  const text = last?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  if (!text) {
    return undefined;
  }
  // The cut names itself, so a reader never mistakes the first part of a long
  // reply for the whole of a short one.
  return maxLength !== undefined && text.length > maxLength
    ? `${text.slice(0, maxLength)}\n[cut here at ${maxLength.toLocaleString("en-US")} characters; the transcript has the rest]`
    : text;
}

/**
 * The session a task's next message goes into, created when the task has
 * never had one: what a wake, a `task send`, and the window's first open all
 * need before they can write.
 */
export async function latestOrNewSessionId(
  taskId: TaskId,
): Promise<Result<StoreId.Session, TypedError.Type>> {
  const newest = await latestSessionId(taskId);
  if (newest.isErr()) {
    return err(newest.error);
  }
  if (newest.value) {
    return ok(newest.value);
  }
  const created = await createSession({
    sessionId: StoreId.newSessionId(),
    taskId,
  });
  return created.map((session) => session.id);
}

/**
 * The session a task's next message goes into: its newest top-level one, or
 * none for a task that has never had a session. Session ids are ulids, so
 * alphabetical order is creation order.
 */
export function latestSessionId(taskId: TaskId) {
  return Store.getSessions(taskId).map(
    (sessions) => alphabetical(sessions, (session) => session.id).at(-1)?.id,
  );
}
