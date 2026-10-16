import { ok, okAsync } from "neverthrow";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { beforeEach } from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { bumpEveryChatGeneration } from "../chat-generation";
import { recordStoreWrite } from "../record-changes";
import { wrapStorage } from "../wrap-storage";

const mockStorage = createStorage({
  driver: memoryDriver(),
});

const wrappedMockStorage = wrapStorage(mockStorage);

/** The shared storage, saying what each write changed, as the real one does. */
export function getSessionsStoreStorage(chatId: ChatId) {
  return ok({
    ...wrappedMockStorage,
    batch: (
      writes: Parameters<typeof wrappedMockStorage.batch>[0],
      options?: Parameters<typeof wrappedMockStorage.batch>[1],
    ) =>
      wrappedMockStorage.batch(writes, options).andTee(() => {
        for (const write of writes) {
          recordStoreWrite(chatId, write.key, { removed: "remove" in write });
        }
      }),
    removeItem: (
      key: string,
      options?: Parameters<typeof wrappedMockStorage.removeItem>[1],
    ) =>
      wrappedMockStorage.removeItem(key, options).andTee(() => {
        recordStoreWrite(chatId, key, { removed: true });
      }),
    setItemRaw: (
      key: string,
      value: string,
      options?: Parameters<typeof wrappedMockStorage.setItemRaw>[2],
    ) =>
      wrappedMockStorage.setItemRaw(key, value, options).andTee(() => {
        recordStoreWrite(chatId, key, { removed: false });
      }),
  });
}

/** Nothing to close: every chat shares the one in-memory storage. */
export function disposeSessionsStoreStorage(_chatId: ChatId) {
  return okAsync(undefined);
}

beforeEach(async () => {
  await mockStorage.clear();
  bumpEveryChatGeneration();
});
