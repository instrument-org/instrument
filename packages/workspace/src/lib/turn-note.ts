import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { resolveChat } from "./record-folders";
import { Store } from "./store";
import { systemNote } from "./system-note";
import { isTypedByUser } from "./typed-by-user";

/**
 * What the first step of a chat's turn is sent with when the user typed the
 * message it answers: a line to them before any work, and then quiet until
 * the outcome. A note rather than a prompt rule, since it is read where the
 * turn starts, and placed after the cache breakpoints for that one request,
 * never stored. A fork gets none: nobody reads its lines as they come.
 */
export const TURN_NOTE = systemNote`
  Before using any tool, write one sentence to the user about what you'll do, then nothing more until the outcome. If no tool is needed, just answer.
`;

/**
 * Whether the next step opens a turn the user typed: the turn's message is
 * the user's own words, not a note the harness wrote or one a fork
 * inherited, and no step of the turn has run yet. A failed step does not
 * count, since its retry is still the turn's first.
 */
export function opensTypedTurn(messages: SessionMessage.WithParts[]): boolean {
  const start = messages.findLastIndex((message) => message.role === "user");
  const opener = messages[start];
  if (
    opener === undefined ||
    opener.metadata.inherited === true ||
    !isTypedByUser(opener)
  ) {
    return false;
  }
  return !messages
    .slice(start + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.metadata.error === undefined &&
        !message.metadata.synthetic,
    );
}

/**
 * The note a session's next step carries, read from its stored transcript:
 * `TURN_NOTE` on the first step of a chat's typed turn, otherwise none.
 */
export async function turnNoteFor({
  sessionId,
  signal,
  taskId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}): Promise<string | undefined> {
  if (resolveChat(taskId) === undefined) {
    return undefined;
  }
  const messages = await Store.getMessagesWithParts(
    { sessionId, taskId },
    { signal },
  );
  return messages.isOk() && opensTypedTurn(messages.value)
    ? TURN_NOTE
    : undefined;
}
