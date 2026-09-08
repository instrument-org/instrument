import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

const TaskAppsBaselineSchema = z.array(z.string());

type TaskAppsBaseline = z.output<typeof TaskAppsBaselineSchema>;

/**
 * Reads the session's persisted baseline of the apps the task may reach, or
 * undefined when none is stored yet.
 */
export function getTaskAppsBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<TaskAppsBaseline | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const result = await getParsedStorageItem(
      StorageKey.taskAppsBaseline(sessionId),
      TaskAppsBaselineSchema,
      storage,
      { signal },
    );
    if (result.isErr()) {
      // Missing baseline is expected on the first message of a session.
      return ok(undefined);
    }
    return ok(result.value);
  });
}

/** Persists the apps baseline for the session. */
export function setTaskAppsBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  slugs: TaskAppsBaseline,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.taskAppsBaseline(sessionId),
      slugs,
      TaskAppsBaselineSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
