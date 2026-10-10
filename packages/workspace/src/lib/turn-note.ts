import { joinedMidTurn } from "./chat/mid-turn";
import { isToolPart } from "./is-tool-part";
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
  Before using any tool, tell the user in a few words what you are doing ("Reading the lease."), the work rather than their request said back, then nothing more until the outcome. If no tool is needed, just answer.
`;

/**
 * Whether the next step opens a turn the user typed: the turn's message is
 * the user's own words, not a note the harness wrote or one a fork
 * inherited, nor one that joined a turn already under way, and no step of
 * the turn has run yet. A failed step does not count, since its retry is
 * still the turn's first.
 */
export function opensTypedTurn(messages: SessionMessage.WithParts[]): boolean {
  const start = messages.findLastIndex((message) => message.role === "user");
  const opener = messages[start];
  if (
    opener === undefined ||
    opener.metadata.inherited === true ||
    !isTypedByUser(opener) ||
    joinedMidTurn(opener)
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
 * What a step is sent with when the turn's last step only wrote, promising
 * work it never called (`shouldContinueAfterHandingOff` gives it one more
 * step). Without a message after it, the request would end on the agent's own
 * reply, which some providers refuse as prefill.
 */
export const PROMISED_NOTE = systemNote`
  Your last reply said you would start work but called no tool. Do it now, without saying the line again.
`;

/**
 * Whether the next step continues the agent's own reply: the turn's latest
 * message is a step of the agent's that finished with text and no tool call.
 */
export function continuesOwnReply(
  messages: SessionMessage.WithParts[],
): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.metadata.error === undefined &&
    !last.metadata.synthetic &&
    last.parts.some(
      (part) => part.type === "text" && part.text.trim() !== "",
    ) &&
    !last.parts.some((part) => isToolPart(part))
  );
}

/**
 * The note a session's next step carries, read from its stored transcript:
 * `PROMISED_NOTE` on a step that continues the agent's own reply,
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
  const messages = await Store.getMessagesWithParts(
    { sessionId, taskId },
    { signal },
  );
  if (messages.isErr()) {
    return undefined;
  }
  if (continuesOwnReply(messages.value)) {
    return PROMISED_NOTE;
  }
  return resolveChat(taskId) !== undefined && opensTypedTurn(messages.value)
    ? TURN_NOTE
    : undefined;
}
