import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { isTaskSession } from "./chat/children";
import { sessionOfChat } from "./record-folders";

/**
 * The session a request names to the provider, which is what its prompt
 * cache is routed by (Workers AI's affinity, the ChatGPT plan's session): a
 * request's own, except a task's, which names its chat's. A task's first
 * request is the chat's conversation byte for byte, and that prefix is
 * cached wherever the chat's requests went.
 */
export function cacheSessionFor({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}): StoreId.Session {
  if (!isTaskSession(chatId, sessionId)) {
    return sessionId;
  }
  return sessionOfChat(chatId) ?? sessionId;
}
