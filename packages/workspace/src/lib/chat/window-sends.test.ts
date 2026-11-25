import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import {
  JUST_SENT_MS,
  noteWindowSend,
  windowJustSentFrom,
} from "./window-sends";

/** The session's messages, oldest first, as its records would read. */
let messages: { id: StoreId.Message; role: "assistant" | "user" }[];
vi.mock(import("../chat-reads"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    ChatReads: {
      ...original.ChatReads,
      history: (() => Promise.resolve(ok(messages))) as never,
    },
  };
});

const chatId = ChatIdSchema.parse("window-sends-chat");
const at = Date.UTC(2026, 10, 25, 12);

describe("windowJustSentFrom", () => {
  let sessionId: StoreId.Session;
  const sent = StoreId.newMessageId();
  beforeEach(() => {
    sessionId = StoreId.newSessionId();
    messages = [{ id: sent, role: "user" }];
  });

  it("is the window the newest message was sent from, while it is new", async () => {
    noteWindowSend(sessionId, { at, messageId: sent, window: 7 });
    expect(
      await windowJustSentFrom({ chatId, now: at + 1000, sessionId }),
    ).toBe(7);
    expect(
      await windowJustSentFrom({
        chatId,
        now: at + JUST_SENT_MS + 1,
        sessionId,
      }),
    ).toBeUndefined();
  });

  it("is nothing for a session no window sent in", async () => {
    expect(
      await windowJustSentFrom({ chatId, now: at, sessionId }),
    ).toBeUndefined();
  });

  it("is nothing once a message no window sent is the newest", async () => {
    noteWindowSend(sessionId, { at, messageId: sent, window: 7 });
    messages.push(
      { id: StoreId.newMessageId(), role: "assistant" },
      { id: StoreId.newMessageId(), role: "user" },
    );
    expect(
      await windowJustSentFrom({ chatId, now: at, sessionId }),
    ).toBeUndefined();
  });
});
