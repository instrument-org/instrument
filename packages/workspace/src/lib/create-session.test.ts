import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatReads } from "./chat-reads";
import { ensureChatSession } from "./create-session";
import { sessionOfChat } from "./record-folders";

vi.mock(import("./session-store-storage"));

describe("ensureChatSession", () => {
  it("writes the session a chat's settings name when the chat has none, once", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("no-session-row"));

    const first = await ensureChatSession(chatId);
    const again = await ensureChatSession(chatId);

    expect(first._unsafeUnwrap().id).toBe(sessionOfChat(chatId));
    expect(again._unsafeUnwrap().createdAt).toEqual(
      first._unsafeUnwrap().createdAt,
    );
    const sessions = await ChatReads.sessions({ chatId });
    expect(sessions._unsafeUnwrap().map((session) => session.id)).toEqual([
      sessionOfChat(chatId),
    ]);
  });

  it("refuses a record that is no chat", async () => {
    const result = await ensureChatSession(ChatIdSchema.parse("not-a-chat"));
    expect(result._unsafeUnwrapErr().type).toBe("workspace-not-found-error");
  });
});
