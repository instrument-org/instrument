import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

/** The granted folders a session was last told of, by path and mount name. */
const FoldersBaselineSchema = z.array(
  z.object({ name: z.string(), path: z.string() }),
);

type FoldersBaseline = z.output<typeof FoldersBaselineSchema>;

/** Reads the session's folders baseline, or undefined when none is stored yet. */
export function getFoldersBaseline(
  chatId: ChatId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<FoldersBaseline | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(chatId);
    const result = await getParsedStorageItem(
      StorageKey.foldersBaseline(sessionId),
      FoldersBaselineSchema,
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

/** Persists the folders baseline for the session. */
export function setFoldersBaseline(
  chatId: ChatId,
  sessionId: StoreId.Session,
  folders: FoldersBaseline,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(chatId);
    yield* setParsedStorageItem(
      StorageKey.foldersBaseline(sessionId),
      folders,
      FoldersBaselineSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
