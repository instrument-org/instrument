import { type ChatId } from "../../schemas/chat-id";
import { ChatReads } from "../chat-reads";
import { type Memory } from "./store";

/**
 * The titles the chats memories were learned in go by now, read from their
 * records once a chat, so a chat renamed since is named as it is. A chat
 * that is gone or has no title is left out.
 */
export async function learnedIn(
  memories: readonly Memory[],
): Promise<ReadonlyMap<ChatId, string>> {
  const chats = [...new Set(memories.flatMap((memory) => memory.chat ?? []))];
  const titles = await Promise.all(
    chats.map(async (chatId) => [chatId, await titleOf(chatId)] as const),
  );
  return new Map(
    titles.flatMap(([chatId, title]) =>
      title ? [[chatId, title] as const] : [],
    ),
  );
}

/** The title of the chat's own session, the one no other session started. */
async function titleOf(chatId: ChatId): Promise<string | undefined> {
  const sessions = await ChatReads.sessions({ chatId });
  const title = sessions.isOk() ? sessions.value[0]?.title.trim() : undefined;
  return title || undefined;
}
