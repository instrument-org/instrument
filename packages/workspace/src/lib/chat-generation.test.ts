import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { bumpChatGeneration, cacheByChatGeneration } from "./chat-generation";

const chatId = ChatIdSchema.parse("2026-10-01-chat-generation");
const otherChatId = ChatIdSchema.parse("2026-10-01-another-chat");
const session = StoreId.newSessionId();
const sibling = StoreId.newSessionId();

describe("cacheByChatGeneration", () => {
  it("keeps a value until its session changes, whatever else its chat does", async () => {
    const cache = cacheByChatGeneration<number>();
    let computed = 0;
    const read = () =>
      cache(chatId, session, () => Promise.resolve(++computed));

    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    bumpChatGeneration(otherChatId, session);
    bumpChatGeneration(chatId, sibling);
    expect(await read()).toBe(1);
    bumpChatGeneration(chatId, session);
    expect(await read()).toBe(2);
  });

  it("derives every session again when the chat itself changes", async () => {
    const cache = cacheByChatGeneration<number>();
    let computed = 0;
    const read = () =>
      cache(chatId, sibling, () => Promise.resolve(++computed));

    expect(await read()).toBe(1);
    bumpChatGeneration(chatId);
    expect(await read()).toBe(2);
  });

  it("does not keep a value whose session changed while it was computed", async () => {
    const cache = cacheByChatGeneration<number>();
    let computed = 0;
    const first = cache(chatId, session, () => {
      computed += 1;
      bumpChatGeneration(chatId, session);
      return Promise.resolve(computed);
    });
    expect(await first).toBe(1);
    expect(
      await cache(chatId, session, () => Promise.resolve(++computed)),
    ).toBe(2);
  });

  it("forgets a value that failed", async () => {
    const cache = cacheByChatGeneration<number>();
    await expect(
      cache(chatId, session, () => Promise.reject(new Error("unreadable"))),
    ).rejects.toThrow("unreadable");
    expect(await cache(chatId, session, () => Promise.resolve(3))).toBe(3);
  });
});
