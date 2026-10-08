import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type TaskSettings } from "../schemas/task-settings";
import { owningChat, sessionOfChat } from "./record-folders";

/**
 * The session a request names to the provider, which is what its prompt
 * cache is routed by (Workers AI's affinity, the ChatGPT plan's session): a
 * request's own, except a fork's, which names its chat's. A fork's first
 * request is the chat's conversation byte for byte, and that prefix is
 * cached wherever the chat's requests went.
 */
export function cacheSessionFor({
  sessionId,
  settings,
  taskId,
}: {
  sessionId: StoreId.Session;
  settings: TaskSettings | undefined;
  taskId: TaskId;
}): StoreId.Session {
  if (!settings?.fork) {
    return sessionId;
  }
  const chatId = owningChat(taskId);
  return (chatId && sessionOfChat(chatId)) ?? sessionId;
}
