import { ok, safeTry } from "neverthrow";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import {
  type ProjectFileIndex,
  projectFileIndexFromSnapshot,
  ProjectFileIndexSnapshotSchema,
  projectFileIndexToSnapshot,
} from "./get-project-files";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

/** Reads the session's persisted file-index baseline, or undefined when none is stored yet. */
export function getFileIndexBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<ProjectFileIndex | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const result = await getParsedStorageItem(
      StorageKey.fileIndexBaseline(sessionId),
      ProjectFileIndexSnapshotSchema,
      storage,
      { signal },
    );
    if (result.isErr()) {
      // Missing baseline is expected on the first message of a session.
      return ok(undefined);
    }
    return ok(projectFileIndexFromSnapshot(result.value));
  });
}

/** Persists the file-index baseline for the session. */
export function setFileIndexBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  index: ProjectFileIndex,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.fileIndexBaseline(sessionId),
      projectFileIndexToSnapshot(index),
      ProjectFileIndexSnapshotSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
