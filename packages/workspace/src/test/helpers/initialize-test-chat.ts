import { initializeChat } from "../../lib/initialize-chat";
import { type ChatId } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";

/**
 * Makes a record the way the product does, which is always a chat: one
 * named by `chatId`. Returns it.
 */
export async function initializeTestChat({
  chatId,
}: {
  chatId: ChatId;
}): Promise<ChatId> {
  (
    await initializeChat({
      chatId,
      sessionId: StoreId.newSessionId(),
    })
  )._unsafeUnwrap();
  return chatId;
}
