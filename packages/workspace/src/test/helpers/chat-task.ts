import { ChatWrites } from "../../lib/chat-writes";
import { addChildTask } from "../../lib/chat/children";
import { sessionOfChat } from "../../lib/record-folders";
import { chatRecords } from "../../lib/records/chat-records";
import { type ChatId } from "../../schemas/chat-id";
import { type Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";

/**
 * The person's message in a chat's own session, which any chat that starts a
 * task has: the chat's agent starts one in a turn the person's message began.
 */
export async function writtenIn(chatId: ChatId) {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    throw new Error(`${chatId} is not a chat.`);
  }
  const createdAt = new Date();
  // The message goes into the chat's own session, which a chat made for a
  // test alone does not have yet.
  await chatRecords().startSession(chatId, { createdAt, id: sessionId });
  const messageId = StoreId.newMessageId();
  const written = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: { createdAt, sessionId },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: "Look into this.",
          type: "text",
        },
      ],
      role: "user",
    },
    chatId,
  );
  if (written.isErr()) {
    throw written.error;
  }
}

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
