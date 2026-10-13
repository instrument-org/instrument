import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { StorageKey } from "./storage-key";
import {
  bumpStoreGeneration,
  cacheByStoreGeneration,
} from "./store-generation";

const chatId = ChatIdSchema.parse("2026-10-01-store-generation");
const otherChatId = ChatIdSchema.parse("2026-10-01-another-task");
const session = StoreId.newSessionId();
const sibling = StoreId.newSessionId();

describe("cacheByStoreGeneration", () => {
  it("keeps a value until its session is written, whatever else its chat writes", async () => {
    const cache = cacheByStoreGeneration<number>();
    let computed = 0;
    const read = () =>
      cache(chatId, session, () => Promise.resolve(++computed));

    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    bumpStoreGeneration(otherChatId);
    bumpStoreGeneration(chatId, StorageKey.messages(sibling));
    bumpStoreGeneration(chatId, StorageKey.browserState(sibling));
    expect(await read()).toBe(1);
    bumpStoreGeneration(
      chatId,
      StorageKey.part(session, StoreId.newMessageId(), StoreId.newPartId()),
    );
    expect(await read()).toBe(2);
    bumpStoreGeneration(chatId, StorageKey.session(session));
    expect(await read()).toBe(3);
  });

  it("derives every session again when its chat's store changes as a whole", async () => {
    const cache = cacheByStoreGeneration<number>();
    let computed = 0;
    const read = () =>
      cache(chatId, sibling, () => Promise.resolve(++computed));

    expect(await read()).toBe(1);
    bumpStoreGeneration(chatId, "note");
    expect(await read()).toBe(2);
    bumpStoreGeneration(chatId);
    expect(await read()).toBe(3);
  });

  it("does not keep a value whose session was written while it was computed", async () => {
    const cache = cacheByStoreGeneration<number>();
    let computed = 0;
    const first = cache(chatId, session, () => {
      computed += 1;
      bumpStoreGeneration(chatId, StorageKey.messages(session));
      return Promise.resolve(computed);
    });
    expect(await first).toBe(1);
    expect(
      await cache(chatId, session, () => Promise.resolve(++computed)),
    ).toBe(2);
  });

  it("forgets a value that failed", async () => {
    const cache = cacheByStoreGeneration<number>();
    await expect(
      cache(chatId, session, () => Promise.reject(new Error("unreadable"))),
    ).rejects.toThrow("unreadable");
    expect(await cache(chatId, session, () => Promise.resolve(3))).toBe(3);
  });
});
