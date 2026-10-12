import { ok, okAsync } from "neverthrow";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { beforeEach } from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { recordStoreWrite } from "../record-changes";
import {
  bumpEveryStoreGeneration,
  bumpStoreGeneration,
} from "../store-generation";
import { type WrappedStorage, wrapStorage } from "../wrap-storage";

const mockStorage = createStorage({
  driver: memoryDriver(),
});

const wrappedMockStorage = wrapStorage(mockStorage);

/**
 * The shared storage, counting each write against the task it was made for
 * and saying what it changed, as the real one does.
 */
export function getSessionsStoreStorage(chatId: ChatId) {
  const counted: WrappedStorage = {
    ...wrappedMockStorage,
    batch: (writes, options) => {
      for (const write of writes) {
        bumpStoreGeneration(chatId, write.key);
      }
      return wrappedMockStorage.batch(writes, options).andTee(() => {
        for (const write of writes) {
          bumpStoreGeneration(chatId, write.key);
          recordStoreWrite(chatId, write.key, { removed: "remove" in write });
        }
      });
    },
    removeItem: (key, options) => {
      bumpStoreGeneration(chatId, key);
      return wrappedMockStorage.removeItem(key, options).andTee(() => {
        bumpStoreGeneration(chatId, key);
        recordStoreWrite(chatId, key, { removed: true });
      });
    },
    setItemRaw: (key, value, options) => {
      bumpStoreGeneration(chatId, key);
      return wrappedMockStorage.setItemRaw(key, value, options).andTee(() => {
        bumpStoreGeneration(chatId, key);
        recordStoreWrite(chatId, key, { removed: false });
      });
    },
  };
  return ok(counted);
}

/** Nothing to close: every task shares the one in-memory storage. */
export function disposeSessionsStoreStorage(chatId: ChatId) {
  bumpStoreGeneration(chatId);
  return okAsync(undefined);
}

beforeEach(async () => {
  await mockStorage.clear();
  bumpEveryStoreGeneration();
});
