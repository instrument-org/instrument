import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type AppConfig } from "./app-config/types";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

const BrowserStateSchema = z.object({
  lastTitle: z.string().optional(),
  lastUrl: z.string().optional(),
  lastUsedAt: z.date(),
});

type BrowserState = z.output<typeof BrowserStateSchema>;

export function getBrowserState(
  appConfig: AppConfig,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<BrowserState | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(appConfig);
    const result = await getParsedStorageItem(
      StorageKey.browserState(sessionId),
      BrowserStateSchema,
      storage,
      { signal },
    );
    if (result.isErr()) {
      return ok(undefined);
    }
    return ok(result.value);
  });
}

export function recordBrowserUse({
  appConfig,
  sessionId,
  signal,
  title,
  url,
}: {
  appConfig: AppConfig;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  title?: string;
  url?: string;
}) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(appConfig);
    const current = yield* getBrowserState(appConfig, sessionId, { signal });
    const state: BrowserState = {
      ...(current?.lastTitle ? { lastTitle: current.lastTitle } : {}),
      ...(current?.lastUrl ? { lastUrl: current.lastUrl } : {}),
      ...(title ? { lastTitle: title } : {}),
      ...(url ? { lastUrl: url } : {}),
      lastUsedAt: new Date(),
    };
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      state,
      BrowserStateSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}
