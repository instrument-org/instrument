import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureChat } from "../../lib/chat/chat-records";
import { chatIsWorking } from "../../lib/chat/chats";
import { startChatRetitle, TITLE_TRIES } from "../../lib/chat/retitle";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { publisher } from "../publisher";

vi.mock(import("../../lib/chat/chats"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatIsWorking: vi.fn(),
}));

beforeAll(() => {
  startChatRetitle();
});

beforeEach(() => {
  vi.mocked(chatIsWorking).mockResolvedValue(false);
});

describe("a chat with nothing to name", () => {
  async function says(
    chatId: ChatId,
    sessionId: StoreId.Session,
    text: string,
  ) {
    const messageId = StoreId.newMessageId();
    const createdAt = new Date();
    (
      await ChatWrites.saveMessageWithParts(
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
              text,
              type: "text",
            },
          ],
          role: "user",
        },
        chatId,
      )
    )._unsafeUnwrap();
  }

  async function settledAt(chatId: ChatId, sessionId: StoreId.Session) {
    return (await ChatReads.session({ chatId, sessionId }))._unsafeUnwrap()
      .titleSettledAt;
  }

  // Without a reply there is nothing to name it from, which is the answer
  // the titler gives a greeting, without a model call.
  it("keeps its opening words once the person has sent their third message", async () => {
    const sessionId = StoreId.newSessionId();
    const chatId = await ensureChat(sessionId, "hi");
    const asks = ["hi", "hey", "test"];
    expect(asks).toHaveLength(TITLE_TRIES);
    for (const said of asks.slice(0, -1)) {
      await says(chatId, sessionId, said);
      publisher.publish("chat.settled", { id: chatId, sessionId });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await settledAt(chatId, sessionId)).toBeUndefined();

    await says(chatId, sessionId, asks.at(-1) ?? "");
    publisher.publish("chat.settled", { id: chatId, sessionId });
    await vi.waitFor(async () => {
      expect(await settledAt(chatId, sessionId)).toBeDefined();
    });
  });
});
