import { ok, okAsync } from "neverthrow";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { beforeEach } from "vitest";

import { type TaskId } from "../../schemas/task-id";
import {
  bumpEveryStoreGeneration,
  bumpStoreGeneration,
} from "../store-generation";
import { type WrappedStorage, wrapStorage } from "../wrap-storage";

const mockStorage = createStorage({
  driver: memoryDriver(),
});

const wrappedMockStorage = wrapStorage(mockStorage);

/** The shared storage, counting each write against the task it was made for, as the real one does. */
export function getSessionsStoreStorage(taskId: TaskId) {
  const counted: WrappedStorage = {
    ...wrappedMockStorage,
    removeItem: (key, options) => {
      bumpStoreGeneration(taskId);
      return wrappedMockStorage.removeItem(key, options).andTee(() => {
        bumpStoreGeneration(taskId);
      });
    },
    setItemRaw: (key, value, options) => {
      bumpStoreGeneration(taskId);
      return wrappedMockStorage.setItemRaw(key, value, options).andTee(() => {
        bumpStoreGeneration(taskId);
      });
    },
  };
  return ok(counted);
}

/** Nothing to close: every task shares the one in-memory storage. */
export function disposeSessionsStoreStorage(taskId: TaskId) {
  bumpStoreGeneration(taskId);
  return okAsync(undefined);
}

beforeEach(async () => {
  await mockStorage.clear();
  bumpEveryStoreGeneration();
});
