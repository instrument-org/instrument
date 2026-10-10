import { initializeChat } from "../../lib/initialize-task";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type ChatId } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { type ChatSettingsUpdate } from "../../schemas/chat-settings";

/**
 * Makes a record the way the product does, which is always a chat: one
 * named by `chatId`, with these settings. Returns it.
 */
export async function initializeTestChat({
  initialSettings,
  chatId,
}: {
  initialSettings: Omit<
    ChatSettingsUpdate,
    "chatSessionId" | "createdWithAppVersion"
  >;
  chatId: ChatId;
}): Promise<ChatId> {
  (
    await initializeChat({
      chatId,
      initialSettings,
      sessionId: StoreId.newSessionId(),
      workspaceConfig: getWorkspaceConfig(),
    })
  )._unsafeUnwrap();
  return chatId;
}
