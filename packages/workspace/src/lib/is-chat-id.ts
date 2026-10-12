import { type ChatId, ChatIdSchema } from "../schemas/chat-id";

export function isChatId(id: string): id is ChatId {
  return ChatIdSchema.safeParse(id).success;
}
