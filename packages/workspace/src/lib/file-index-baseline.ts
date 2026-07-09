import { ok, safeTry } from "neverthrow";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import {
  type TaskFileIndex,
  taskFileIndexFromSnapshot,
  TaskFileIndexSnapshotSchema,
  taskFileIndexToSnapshot,
} from "./get-task-files";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

/**
 * Removes every session's persisted file-index baseline for the task. Used after
 * duplicating a task: the copy rewrites each file's mtime, so a baseline carried
 * over from the source would make the duplicate's first message diff the whole
 * tree as changed on disk. Dropping it lets the first turn re-establish a fresh
 * baseline, exactly like a brand-new session.
 */
export function clearFileIndexBaselines(
  taskId: TaskId,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const keys = yield* storage.getKeys(StorageKey.FILE_INDEX_BASELINE_KEY, {
      signal,
    });
    for (const key of keys) {
      yield* storage.removeItem(key, { signal });
    }
    return ok(undefined);
  });
}

/** Reads the session's persisted file-index baseline, or undefined when none is stored yet. */
export function getFileIndexBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<TaskFileIndex | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const result = await getParsedStorageItem(
      StorageKey.fileIndexBaseline(sessionId),
      TaskFileIndexSnapshotSchema,
      storage,
      { signal },
    );
    if (result.isErr()) {
      // Missing baseline is expected on the first message of a session.
      return ok(undefined);
    }
    return ok(taskFileIndexFromSnapshot(result.value));
  });
}

/** Persists the file-index baseline for the session. */
export function setFileIndexBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  index: TaskFileIndex,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.fileIndexBaseline(sessionId),
      taskFileIndexToSnapshot(index),
      TaskFileIndexSnapshotSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
