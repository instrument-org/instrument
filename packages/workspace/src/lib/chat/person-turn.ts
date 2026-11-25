import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { opensTurn } from "../transcript/turns-of";
import { isWorking } from "./activity";

/**
 * Whether a session is at work on what the person last sent it: a turn of
 * theirs is running, and nothing has woken the session since. A wake that
 * reaches a turn while it runs counts as one too, so what asks this answers
 * no when it can't tell whose the turn is.
 */
export async function isPersonsTurn(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<boolean> {
  if (!isWorking(chatId, sessionId)) {
    return false;
  }
  const history = await ChatReads.history({ chatId, sessionId });
  const last = history.isOk()
    ? history.value.findLast((message) => message.role === "user")
    : undefined;
  return last !== undefined && opensTurn(last);
}
