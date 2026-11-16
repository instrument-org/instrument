import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { newChatName } from "../chat-folder-name";
import { getCurrentDate } from "../get-current-date";
import { initializeChat } from "../initialize-chat";
import {
  chatIds,
  chatOfSession,
  chatIdTaken,
  sessionOfChat,
} from "../record-folders";
import { listedBefore } from "./chat-list-events";

/**
 * A chat's record, made the first time something is sent in it, and named on
 * disk for the day it began, a few words of what was asked, and a short
 * random suffix.
 * It runs the conversation's agent, and holds only the folders sent in it
 * (what else it reaches is in folder-reach.ts). Asked again for the same
 * session, it answers with the chat it made.
 */
export async function ensureChat(
  sessionId: StoreId.Session,
  firstWords?: string,
): Promise<ChatId> {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const chatId = ChatIdSchema.parse(
    newChatName({
      date: getCurrentDate(),
      isTaken: chatIdTaken,
      title: firstWords,
    }),
  );
  const made = await initializeChat({
    chatId,
    opening: firstWords,
    sessionId,
  });
  if (made.isErr()) {
    // Two sends racing for the same new chat: the other one made it.
    const raced = chatOfSession(sessionId);
    if (raced) {
      return raced;
    }
    throw made.error;
  }
  return chatId;
}

/**
 * Every chat's record id, oldest first: by its session's id, a ULID, which
 * orders to the millisecond where the day in a folder's name does not.
 */
export function listChatIds(): ChatId[] {
  return chatIds().sort((a, b) =>
    listedBefore(sessionOfChat(a) ?? "", sessionOfChat(b) ?? ""),
  );
}
