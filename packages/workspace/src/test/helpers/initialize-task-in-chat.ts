import { initializeChat } from "../../lib/initialize-task";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { type TaskSettingsUpdate } from "../../schemas/task-settings";

/**
 * Makes a record the way the product does, which is always a chat: one
 * named by `taskId`, with these settings. Returns it.
 */
export async function initializeTaskInChat({
  initialSettings,
  taskId,
}: {
  initialSettings: Omit<
    TaskSettingsUpdate,
    "chatSessionId" | "createdWithAppVersion"
  >;
  taskId: TaskId;
}): Promise<ChatId> {
  const chatId = ChatIdSchema.parse(taskId);
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
