import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

const AttachedFoldersBaselineSchema = z.array(
  z.object({
    name: z.string(),
    path: z.string(),
  }),
);

type AttachedFoldersBaseline = z.output<typeof AttachedFoldersBaselineSchema>;

/** Reads the session's persisted attached-folders baseline, or undefined when none is stored yet. */
export function getAttachedFoldersBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<AttachedFoldersBaseline | undefined, Error>(
    async function* () {
      const storage = yield* getSessionsStoreStorage(taskId);
      const result = await getParsedStorageItem(
        StorageKey.attachedFoldersBaseline(sessionId),
        AttachedFoldersBaselineSchema,
        storage,
        { signal },
      );
      if (result.isErr()) {
        // Missing baseline is expected on the first message of a session.
        return ok(undefined);
      }
      return ok(result.value);
    },
  );
}

/** Persists the attached-folders baseline for the session. */
export function setAttachedFoldersBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  folders: AttachedFoldersBaseline,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.attachedFoldersBaseline(sessionId),
      folders,
      AttachedFoldersBaselineSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
