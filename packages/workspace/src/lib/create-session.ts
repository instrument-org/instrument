import { err } from "neverthrow";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatWrites } from "./chat-writes";
import { TypedError } from "./errors";
import { generateSessionTitle } from "./generate-session-title";
import { sessionOfChat } from "./record-folders";
import { ChatReads } from "./chat-reads";

export async function createSession({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  const title = await generateSessionTitle({
    chatId,
  });
  const now = new Date();
  const result = await ChatWrites.saveSession(
    {
      createdAt: now,
      id: sessionId,
      title,
      updatedAt: now,
    },
    chatId,
  );

  return result;
}

/**
 * A chat's own session, the one its settings name. Made with the chat, so
 * this only writes it for a chat made before that, on its first send.
 */
export async function ensureChatSession(chatId: ChatId) {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return err(new TypedError.NotFound(`${chatId} is not a chat.`));
  }
  const existing = await ChatReads.session({ chatId, sessionId });
  if (existing.isOk() || existing.error.type !== "workspace-not-found-error") {
    return existing;
  }
  return createSession({ chatId, sessionId });
}
