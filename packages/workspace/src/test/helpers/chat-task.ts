import { addChildTask } from "../../lib/chat/children";
import { type ChatId } from "../../schemas/chat-id";
import { type Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";

/**
 * A task of a chat's, the way `task new` makes one: a session in the chat's
 * store started from the chat's own, under the chat's next handle. Carries on
 * from nothing of the chat's unless `forkedAtMessageId` says where. Returns
 * its session.
 */
export async function chatTaskFor(
  chatId: ChatId,
  {
    sessionId = StoreId.newSessionId(),
    title = "Task",
    ...rest
  }: Partial<Omit<Session.Type, "handle" | "id" | "parentId">> & {
    sessionId?: StoreId.Session;
  } = {},
): Promise<StoreId.Session> {
  const now = new Date();
  const task = await addChildTask(chatId, {
    createdAt: now,
    updatedAt: now,
    ...rest,
    id: sessionId,
    title,
  });
  return task.id;
}
