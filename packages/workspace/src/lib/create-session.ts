import { err } from "neverthrow";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatWrites } from "./chat-writes";
import { TypedError } from "./errors";
import { openingTitle } from "./chat/shown-title";
import { generateSessionTitle } from "./generate-session-title";
import { sessionOfChat } from "./record-folders";
import { ChatReads } from "./chat-reads";

/**
 * Writes a chat's own session, untitled. Its header starts it as the
 * opening ask's first words, the title the chat is shown by until it is
 * named, so a device that has its log and not yet the settings naming it
 * still has that; with no words to go by, as the untitled placeholder.
 */
export async function createSession({
  sessionId,
  chatId,
  opening = "",
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
  /** What the chat's first message says. */
  opening?: string | undefined;
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
    openingTitle(opening) || undefined,
  );

  return result;
}

/**
 * A chat's own session, the one its settings name. Made with the chat, so
 * this only writes it for a chat made before that, on its first send.
 */
export async function ensureChatSession(chatId: ChatId, opening?: string) {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return err(new TypedError.NotFound(`${chatId} is not a chat.`));
  }
  const existing = await ChatReads.session({ chatId, sessionId });
  if (existing.isOk() || existing.error.type !== "workspace-not-found-error") {
    return existing;
  }
  return createSession({ chatId, opening, sessionId });
}
