import { type Connector, createDatabase, type Database } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { type DatabaseSync } from "node:sqlite";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";

import { type ChatId } from "../schemas/chat-id";
import { TypedError } from "./errors";
import { sweepInterruptedToolCalls } from "./interrupted-tool-calls";
import { recordChanged, storeKeyChange } from "./record-changes";
import { bumpStoreGeneration } from "./store-generation";
import { runStoreMigrations } from "./store-migrations";
import { sessionStorePath } from "./task-dir-utils";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";
import { type WrappedStorage, wrapStorage } from "./wrap-storage";
import { STORE_TABLE } from "./store-table";

/**
 * How many task databases stay open once they have gone idle. Building the
 * chat list touches every chat and every task filed from one, which is
 * hundreds of databases in a workspace that has been used for a while, and
 * none of them would otherwise be closed until the process ends.
 */
const MAX_IDLE_OPEN = 64;

/** How long a database has to go unused before it can be closed. */
const IDLE_MS = 30_000;

interface OpenStore {
  database: Database<Connector<DatabaseSync>>;
  /** Operations started on it and not yet settled; one is never closed under them. */
  inFlight: number;
  lastUsed: number;
  /** Told when the last operation under way settles, by a dispose waiting to close. */
  onIdle?: () => void;
  storage: WrappedStorage;
}

/**
 * Where each task's database is in this process.
 *
 * - No entry: never opened, or disposed since. The next open migrates the
 *   store and sweeps interrupted tool calls, which is only right before any
 *   run of this process has started on it.
 * - `opening`: an open under way, which concurrent first reads share.
 * - `open`: at most one per task, so SQLite never sees two writers from here.
 * - `closed`: closed for being idle. Reopens without migrating or sweeping:
 *   the migrations have nothing left to do, and runs may have started.
 * - `disposing`: being closed as a process ending would. Nothing opens or
 *   starts on it until that finishes and the entry goes.
 */
type StoreEntry =
  | { closing: Promise<void>; phase: "disposing" }
  | { opening: Promise<OpenStore>; phase: "opening" }
  | { phase: "closed" }
  | { phase: "open"; store: OpenStore };

const STORES = new Map<ChatId, StoreEntry>();

/** The storage each task's callers hold, which outlives any one open of its database. */
const HANDLES = new Map<ChatId, WrappedStorage>();

/** Tasks being deleted, which no open may recreate until the deletion is over. */
const DELETING = new Set<ChatId>();

/** How long a dispose waits for operations under way before closing anyway. */
const DRAIN_TIMEOUT_MS = 5000;

let sweepTimer: ReturnType<typeof setTimeout> | undefined;

/** Closes a task's database as a process ending would: the next open migrates and sweeps again. */
export function disposeSessionsStoreStorage(id: ChatId) {
  bumpStoreGeneration(id);
  HANDLES.delete(id);
  const entry = STORES.get(id);
  if (entry?.phase === "disposing") {
    return closingResult(entry.closing);
  }
  const closing = (async () => {
    // A failed open leaves nothing to close.
    const store =
      entry?.phase === "open"
        ? entry.store
        : entry?.phase === "opening"
          ? await entry.opening.catch(() => undefined)
          : undefined;
    if (store) {
      await drained(store);
      await close(store);
    }
  })().finally(() => {
    STORES.delete(id);
  });
  STORES.set(id, { closing, phase: "disposing" });
  return closingResult(closing);
}

export function getSessionsStoreStorage(chatId: ChatId) {
  return ResultAsync.fromPromise(
    fs.access(chatDir(chatId)),
    (error) =>
      new TypedError.NotFound(`Folder ${chatDir(chatId)} does not exist`, {
        cause: error,
      }),
  ).andThen(() => {
    // Opened here rather than on first use, so a database that cannot be
    // opened or migrated fails the caller that asked for it.
    if (STORES.get(chatId)?.phase === "open" && !DELETING.has(chatId)) {
      return ok(handleFor(chatId));
    }
    return openStore(chatId).map(() => handleFor(chatId));
  });
}

export function markStorageAsDisposing(id: ChatId) {
  DELETING.add(id);
}

export function unmarkStorageAsDisposing(id: ChatId) {
  DELETING.delete(id);
}

function closingResult(closing: Promise<void>) {
  return ResultAsync.fromPromise(
    closing,
    (error: unknown) =>
      new TypedError.Storage(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

async function close(open: OpenStore) {
  // Unstorage's db0 driver never closes the database it was given.
  const instance = await open.database.getInstance();
  instance.close();
  await open.storage.dispose();
}

/**
 * Closes the oldest idle databases beyond the cap. One with an operation in
 * flight, or used within the last `IDLE_MS`, stays open whatever the count.
 */
function closeIdle() {
  sweepTimer = undefined;
  const now = Date.now();
  const open = [...STORES].flatMap(([chatId, entry]) =>
    entry.phase === "open" ? [{ store: entry.store, chatId }] : [],
  );
  const idle = open
    .filter(
      ({ store }) => store.inFlight === 0 && now - store.lastUsed > IDLE_MS,
    )
    .sort((a, b) => a.store.lastUsed - b.store.lastUsed);
  let excess = open.length - MAX_IDLE_OPEN;
  for (const { store, chatId } of idle) {
    if (excess <= 0) {
      break;
    }
    STORES.set(chatId, { phase: "closed" });
    excess -= 1;
    void close(store).catch((error: unknown) => {
      if (hasWorkspaceConfig()) {
        getWorkspaceConfig().captureException(
          new TypedError.Storage(`Failed to close the database of ${chatId}`, {
            cause: error,
          }),
        );
      }
    });
  }
  scheduleCloseIdle();
}

/** Resolves once nothing is under way on the store, or after the drain timeout. */
function drained(store: OpenStore): Promise<void> {
  if (store.inFlight === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      store.onIdle = undefined;
      resolve();
    }, DRAIN_TIMEOUT_MS);
    timer.unref();
    store.onIdle = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/** How many databases are open, for the idle sweep's cap. */
function openCount() {
  let count = 0;
  for (const entry of STORES.values()) {
    if (entry.phase === "open") {
      count += 1;
    }
  }
  return count;
}

/** The storage a task's callers hold: each call reaches its open database, reopening it if it was closed for being idle. */
function handleFor(chatId: ChatId): WrappedStorage {
  const known = HANDLES.get(chatId);
  if (known) {
    return known;
  }
  const use = <T>(
    /** The key a write is to, or none for a read. */
    written: string | undefined,
    operation: (storage: WrappedStorage) => ResultAsync<T, TypedError.Storage>,
  ): ResultAsync<T, TypedError.Storage> => {
    const run = (open: OpenStore) => {
      // Counted before the write lands as well as after, so a reader that
      // overlaps the write sees a change either way.
      if (written !== undefined) {
        bumpStoreGeneration(chatId);
      }
      const settle = () => {
        open.inFlight -= 1;
        open.lastUsed = Date.now();
        if (written !== undefined) {
          bumpStoreGeneration(chatId);
        }
        if (open.inFlight === 0) {
          open.onIdle?.();
        }
      };
      return operation(open.storage)
        .andTee(() => {
          settle();
          // Once the write has landed, so whoever re-reads on it reads it.
          if (written !== undefined) {
            recordChanged(chatId, storeKeyChange(written));
          }
        })
        .orTee(settle);
    };
    // Claimed in the same tick as the lookup, so neither the sweep nor a
    // dispose can close it between the two.
    const entry = STORES.get(chatId);
    if (entry?.phase === "open") {
      entry.store.inFlight += 1;
      entry.store.lastUsed = Date.now();
      return run(entry.store);
    }
    return openStore(chatId).andThen((reopened) => {
      reopened.inFlight += 1;
      reopened.lastUsed = Date.now();
      return run(reopened);
    });
  };
  const handle: WrappedStorage = {
    dispose: async () => {
      await disposeSessionsStoreStorage(chatId);
    },
    getItemRaw: (key, options) =>
      use(undefined, (storage) => storage.getItemRaw(key, options)),
    getKeys: (base, options) =>
      use(undefined, (storage) => storage.getKeys(base, options)),
    removeItem: (key, options) =>
      use(key, (storage) => storage.removeItem(key, options)),
    setItemRaw: (key, value, options) =>
      use(key, (storage) => storage.setItemRaw(key, value, options)),
  };
  HANDLES.set(chatId, handle);
  return handle;
}

function openStore(chatId: ChatId): ResultAsync<OpenStore, TypedError.Storage> {
  const entry = STORES.get(chatId);
  if (DELETING.has(chatId) || entry?.phase === "disposing") {
    return errAsync(
      new TypedError.Storage(
        `Cannot create storage for ${chatId} while it is being deleted`,
      ),
    );
  }
  if (entry?.phase === "open") {
    return okAsync(entry.store);
  }
  const opening =
    entry?.phase === "opening"
      ? entry.opening
      : startOpen(chatId, { prepared: entry?.phase === "closed" });
  return ResultAsync.fromPromise(opening, (error) =>
    error instanceof TypedError.Storage
      ? error
      : new TypedError.Storage(
          `Failed to open session database at ${sessionStorePath(chatDir(chatId))}`,
          { cause: error },
        ),
  );
}

function scheduleCloseIdle() {
  if (sweepTimer || openCount() <= MAX_IDLE_OPEN) {
    return;
  }
  sweepTimer = setTimeout(closeIdle, IDLE_MS);
  sweepTimer.unref();
}

function startOpen(
  chatId: ChatId,
  { prepared }: { prepared: boolean },
): Promise<OpenStore> {
  const database = createDatabase(
    sqlite({ path: sessionStorePath(chatDir(chatId)) }),
  );

  const storage = createStorage({
    driver: dbDriver({
      database,
      tableName: STORE_TABLE,
    }),
  });

  // Perform a read to ensure storage is actually usable before caching
  const opened = ResultAsync.fromPromise(
    storage.getItem(`__canary__`),
    (error) =>
      new TypedError.Storage(
        `Failed to read session database at ${sessionStorePath(chatDir(chatId))}`,
        { cause: error },
      ),
  )
    .andThen(() => {
      const wrappedStorage = wrapStorage(storage);
      if (prepared) {
        return ok(wrappedStorage);
      }
      // Before the storage is cached, so nothing can read through it until
      // its data matches what this build expects. Caching after also means
      // this runs once per task per process rather than per read.
      return runStoreMigrations({ storage: wrappedStorage })
        .andThen(() =>
          // Also before caching, and for a stronger reason than cost: a tool
          // call still marked in flight belongs to a process that is gone,
          // and that is only certain while no run of this process can have
          // started, which a task with no entry guarantees. A sweep that fails
          // leaves the parts as they were, which is no worse than not
          // sweeping; opening the task is not held to it.
          sweepInterruptedToolCalls({ storage: wrappedStorage }).orElse(
            (error) => {
              if (hasWorkspaceConfig()) {
                getWorkspaceConfig().captureException(error);
              } else {
                // A script reading a task outside the app has nowhere else
                // to report to.
                console.error("Failed to sweep interrupted tool calls", error);
              }
              return ok(undefined);
            },
          ),
        )
        .map(() => wrappedStorage);
    })
    .mapErr((error) =>
      error instanceof TypedError.Storage
        ? error
        : new TypedError.Storage(
            `Failed to migrate session database at ${sessionStorePath(chatDir(chatId))}`,
            { cause: error },
          ),
    )
    .map((wrappedStorage) => {
      const open: OpenStore = {
        database,
        inFlight: 0,
        lastUsed: Date.now(),
        storage: wrappedStorage,
      };
      return open;
    });

  // The entry this open is recorded under, which it checks for once it lands.
  let entry: StoreEntry | undefined;
  const opening = (async () => {
    const result = await opened;
    // Kept only while this open is still the task's: a dispose that began
    // meanwhile closes it rather than leaving it open on a folder going away.
    const current = STORES.get(chatId);
    const isCurrent = current === entry;
    if (result.isErr()) {
      if (isCurrent) {
        if (prepared) {
          STORES.set(chatId, { phase: "closed" });
        } else {
          STORES.delete(chatId);
        }
      }
      throw result.error;
    }
    if (!isCurrent) {
      await close(result.value);
      throw new TypedError.Storage(
        `Cannot create storage for ${chatId} while it is being deleted`,
      );
    }
    STORES.set(chatId, { phase: "open", store: result.value });
    scheduleCloseIdle();
    return result.value;
  })();
  entry = { opening, phase: "opening" };
  STORES.set(chatId, entry);
  return opening;
}
