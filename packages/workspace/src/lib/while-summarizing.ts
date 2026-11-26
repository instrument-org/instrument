import { type ChatId } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { writingChatRecords } from "./records/chat-records";

/**
 * Runs `work` with the session's running turn marked as writing a summary, a
 * `data-summarizing` part on `messageId` held in memory alone, so every window
 * reading the chat says so for as long as it lasts. The mark goes when `work`
 * settles, however it does.
 */
export async function whileSummarizing<T>(
  {
    chatId,
    messageId,
    sessionId,
  }: {
    chatId: ChatId;
    messageId: StoreId.Message | undefined;
    sessionId: StoreId.Session;
  },
  work: () => Promise<T>,
): Promise<T> {
  const live =
    messageId === undefined
      ? undefined
      : writingChatRecords()?.live(chatId, sessionId);
  const partId = StoreId.newPartId();
  if (live && messageId !== undefined) {
    live.setPart({
      data: {},
      metadata: { createdAt: new Date(), id: partId, messageId, sessionId },
      type: "data-summarizing",
    });
  }
  try {
    return await work();
  } finally {
    live?.forget(partId);
  }
}
