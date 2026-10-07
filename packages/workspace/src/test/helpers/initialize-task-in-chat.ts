import { initializeChat, initializeTask } from "../../lib/initialize-task";
import { resolveChat } from "../../lib/record-folders";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { type TaskSettingsUpdate } from "../../schemas/task-settings";

/**
 * Makes a task the way the product does, inside a chat: `chatId` when given
 * (made first if it is not yet a chat), otherwise a chat named for the task.
 * Returns the chat it went into.
 */
export async function initializeTaskInChat({
  chatId,
  initialSettings,
  taskId,
}: {
  chatId?: ChatId;
  initialSettings: Omit<
    TaskSettingsUpdate,
    "chatSessionId" | "createdWithAppVersion"
  >;
  taskId: TaskId;
}): Promise<ChatId> {
  const workspaceConfig = getWorkspaceConfig();
  const chat = chatId ?? ChatIdSchema.parse(`${taskId}-chat`);
  if (!resolveChat(chat)) {
    (
      await initializeChat({
        chatId: chat,
        initialSettings: { name: "Instrument" },
        sessionId: StoreId.newSessionId(),
        workspaceConfig,
      })
    )._unsafeUnwrap();
  }
  (
    await initializeTask(
      { chatId: chat, initialSettings, taskId, workspaceConfig },
      {},
    )
  )._unsafeUnwrap();
  return chat;
}
