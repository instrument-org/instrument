import { sleep } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { isToolPart } from "../is-tool-part";
import { isTypedByUser } from "../typed-by-user";
import { isWorking } from "./activity";
import { joinedMidTurn } from "./mid-turn";

/** How long a take-back waits for the turn its Stop ended to wind down. */
const WIND_DOWN_MS = 15_000;

/**
 * A message the person's Stop took back, by the draft it was sent from: the
 * draft is kept, folder and all, until its message is answered, so taking
 * the message back is giving the person that draft again.
 */
export interface TakenBack {
  draftId: string;
}

/**
 * The message a Stop pressed now would take back, with what goes with it: the
 * person's newest message in the session, when the model has not answered it.
 *
 * Answered is any words or any tool call in a reply since the last message
 * the person typed; reasoning alone is not, since nothing of it stays on
 * screen. It is the only message the person typed since the last answer, so
 * taking it back leaves no other request unanswered, and it started its turn
 * rather than joining one already at work, whose Stop ends more than this
 * message. A note the app wrote (a task finishing, a sign-in) is no answer
 * and stays where it is, and so does what the app told the agent as the
 * chat began.
 */
export function unansweredMessage(
  history: readonly SessionMessage.WithParts[],
  sessionId: StoreId.Session,
):
  | undefined
  | { message: SessionMessage.UserWithParts; takesOut: StoreId.Message[] } {
  const own = history.filter(
    (message) => message.metadata.sessionId === sessionId,
  );
  const answeredAt = own.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          isToolPart(part) || (part.type === "text" && part.text.trim() !== ""),
      ),
  );
  const since = own.slice(answeredAt + 1);
  const typed = since.filter(
    (message): message is SessionMessage.UserWithParts =>
      message.role === "user" && isTypedByUser(message),
  );
  const [message] = typed;
  if (message === undefined || typed.length > 1 || joinedMidTurn(message)) {
    return undefined;
  }
  const from = since.indexOf(message);
  return {
    message,
    takesOut: since
      .slice(from)
      .filter((each) => each === message || each.role === "assistant")
      .map(({ id }) => id),
  };
}

/**
 * Takes back the chat's message its Stop reached before the model answered
 * it: once the stopped turn has wound down, the message and the empty reply
 * under it go from the session, as a retraction every device reads, and the
 * draft it was sent from is answered for the window to give back. Nothing
 * when the model had answered it, the turn is still stopping after a while,
 * or the message came from no draft, which has nothing to give back.
 */
export async function takeBackUnanswered({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<TakenBack | undefined> {
  const until = Date.now() + WIND_DOWN_MS;
  while (isWorking(chatId, sessionId)) {
    if (Date.now() > until) {
      return undefined;
    }
    await sleep(50);
  }
  const history = await ChatReads.history({ chatId, sessionId });
  if (history.isErr()) {
    return undefined;
  }
  const found = unansweredMessage(history.value, sessionId);
  const draftId = found?.message.metadata.fromDraft;
  if (found === undefined || draftId === undefined) {
    return undefined;
  }
  const retracted = await ChatWrites.retract(chatId, sessionId, found.takesOut);
  return retracted.isOk() ? { draftId } : undefined;
}
