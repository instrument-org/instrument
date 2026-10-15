import { err } from "neverthrow";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { TypedError } from "./errors";
import { generateSessionTitle } from "./generate-session-title";
import { sessionOfChat } from "./record-folders";
import { ChatReads } from "./chat-reads";
import { Store } from "./store";

export async function createSession({
  sessionId,
  signal,
  chatId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  chatId: ChatId;
}) {
  const title = await generateSessionTitle({
    signal,
    chatId,
  });
  const now = new Date();
  const result = await Store.saveSession(
    {
      createdAt: now,
      id: sessionId,
      title,
      updatedAt: now,
    },
    chatId,
    { signal },
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
