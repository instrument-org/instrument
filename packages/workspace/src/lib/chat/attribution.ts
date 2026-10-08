import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { owningChat, sessionOfChat } from "../record-folders";

/**
 * The chat a task was started in: the chat whose folder it is in. A task
 * reports back into that chat, whichever is newest when it finishes.
 */
export function chatOfTask(taskId: TaskId): StoreId.Session | undefined {
  const chatId = owningChat(taskId);
  return chatId === undefined ? undefined : sessionOfChat(chatId);
}
