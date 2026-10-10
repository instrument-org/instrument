import { ok, okAsync } from "neverthrow";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { beforeEach } from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { recordChanged, storeKeyChange } from "../record-changes";
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
export function getSessionsStoreStorage(taskId: ChatId) {
  const counted: WrappedStorage = {
    ...wrappedMockStorage,
    removeItem: (key, options) => {
      bumpStoreGeneration(taskId);
      return wrappedMockStorage.removeItem(key, options).andTee(() => {
        bumpStoreGeneration(taskId);
        recordChanged(taskId, storeKeyChange(key));
      });
    },
    setItemRaw: (key, value, options) => {
      bumpStoreGeneration(taskId);
      return wrappedMockStorage.setItemRaw(key, value, options).andTee(() => {
        bumpStoreGeneration(taskId);
        recordChanged(taskId, storeKeyChange(key));
      });
    },
  };
  return ok(counted);
}

/** Nothing to close: every task shares the one in-memory storage. */
export function disposeSessionsStoreStorage(taskId: ChatId) {
  bumpStoreGeneration(taskId);
  return okAsync(undefined);
}

beforeEach(async () => {
  await mockStorage.clear();
  bumpEveryStoreGeneration();
});
