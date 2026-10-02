import { type Connector, createDatabase, type Database } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { type DatabaseSync } from "node:sqlite";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";

import { type TaskId } from "../schemas/task-id";
import { TypedError } from "./errors";
import { sweepInterruptedToolCalls } from "./interrupted-tool-calls";
import { bumpStoreGeneration } from "./store-generation";
import { runStoreMigrations } from "./store-migrations";
import { sessionStorePath, taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";
import { type WrappedStorage, wrapStorage } from "./wrap-storage";

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
  storage: WrappedStorage;
}

/** Each task's open database, at most one, so SQLite never sees two writers from here. */
const OPEN = new Map<TaskId, OpenStore>();

/** Opens under way, so concurrent first reads share one. */
const OPENING = new Map<TaskId, Promise<OpenStore>>();

/**
 * Tasks whose store this process has migrated and swept. A database closed
 * for being idle reopens without either: the migrations have nothing left
 * to do, and the sweep is only right before any run of this process started.
 */
const PREPARED = new Set<TaskId>();

/** The storage each task's callers hold, which outlives any one open of its database. */
const HANDLES = new Map<TaskId, WrappedStorage>();

// Tracks storages that are currently being disposed to prevent recreation
const DISPOSING_STORAGES = new Set<TaskId>();

let sweepTimer: ReturnType<typeof setTimeout> | undefined;

/** Closes a task's database as a process ending would: the next open migrates and sweeps again. */
export function disposeSessionsStoreStorage(id: TaskId) {
  bumpStoreGeneration(id);
  PREPARED.delete(id);
  HANDLES.delete(id);
  return ResultAsync.fromPromise(
    (async () => {
      // A failed open leaves nothing to close.
      await Promise.allSettled([OPENING.get(id)]);
      const open = OPEN.get(id);
      if (open) {
        OPEN.delete(id);
        await close(open);
      }
      return ok(undefined);
    })(),
    (error: unknown) =>
      new TypedError.Storage(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

export function getSessionsStoreStorage(taskId: TaskId) {
  return ResultAsync.fromPromise(
    fs.access(taskDir(taskId)),
    (error) =>
      new TypedError.NotFound(`Folder ${taskDir(taskId)} does not exist`, {
        cause: error,
      }),
  ).andThen(() => {
    if (DISPOSING_STORAGES.has(taskId)) {
      return err(
        new TypedError.Storage(
          `Cannot create storage for ${taskId} while it is being deleted`,
        ),
      );
    }
    // Opened here rather than on first use, so a database that cannot be
    // opened or migrated fails the caller that asked for it.
    if (OPEN.has(taskId)) {
      return ok(handleFor(taskId));
    }
    return openStore(taskId).map(() => handleFor(taskId));
  });
}

export function markStorageAsDisposing(id: TaskId) {
  DISPOSING_STORAGES.add(id);
}

export function unmarkStorageAsDisposing(id: TaskId) {
  DISPOSING_STORAGES.delete(id);
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
  const idle = [...OPEN]
    .filter(([, open]) => open.inFlight === 0 && now - open.lastUsed > IDLE_MS)
    .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
  let excess = OPEN.size - MAX_IDLE_OPEN;
  for (const [taskId, open] of idle) {
    if (excess <= 0) {
      break;
    }
    OPEN.delete(taskId);
    excess -= 1;
    void close(open).catch((error: unknown) => {
      if (hasWorkspaceConfig()) {
        getWorkspaceConfig().captureException(
          new TypedError.Storage(`Failed to close the database of ${taskId}`, {
            cause: error,
          }),
        );
      }
    });
  }
  scheduleCloseIdle();
}

/** The storage a task's callers hold: each call reaches its open database, reopening it if it was closed for being idle. */
function handleFor(taskId: TaskId): WrappedStorage {
  const known = HANDLES.get(taskId);
  if (known) {
    return known;
  }
  const use = <T>(
    write: boolean,
    operation: (storage: WrappedStorage) => ResultAsync<T, TypedError.Storage>,
  ): ResultAsync<T, TypedError.Storage> => {
    const run = (open: OpenStore) => {
      // Counted before the write lands as well as after, so a reader that
      // overlaps the write sees a change either way.
      if (write) {
        bumpStoreGeneration(taskId);
      }
      const settle = () => {
        open.inFlight -= 1;
        open.lastUsed = Date.now();
        if (write) {
          bumpStoreGeneration(taskId);
        }
      };
      return operation(open.storage).andTee(settle).orTee(settle);
    };
    // Claimed in the same tick as the lookup, so the sweep cannot close it
    // between the two.
    const open = OPEN.get(taskId);
    if (open) {
      open.inFlight += 1;
      open.lastUsed = Date.now();
      return run(open);
    }
    return openStore(taskId).andThen((reopened) => {
      reopened.inFlight += 1;
      reopened.lastUsed = Date.now();
      return run(reopened);
    });
  };
  const handle: WrappedStorage = {
    dispose: async () => {
      await disposeSessionsStoreStorage(taskId);
    },
    getItemRaw: (key, options) =>
      use(false, (storage) => storage.getItemRaw(key, options)),
    getKeys: (base, options) =>
      use(false, (storage) => storage.getKeys(base, options)),
    removeItem: (key, options) =>
      use(true, (storage) => storage.removeItem(key, options)),
    setItemRaw: (key, value, options) =>
      use(true, (storage) => storage.setItemRaw(key, value, options)),
  };
  HANDLES.set(taskId, handle);
  return handle;
}

function openStore(taskId: TaskId): ResultAsync<OpenStore, TypedError.Storage> {
  if (DISPOSING_STORAGES.has(taskId)) {
    return errAsync(
      new TypedError.Storage(
        `Cannot create storage for ${taskId} while it is being deleted`,
      ),
    );
  }
  const opening = OPENING.get(taskId) ?? startOpen(taskId);
  return ResultAsync.fromPromise(opening, (error) =>
    error instanceof TypedError.Storage
      ? error
      : new TypedError.Storage(
          `Failed to open session database at ${sessionStorePath(taskDir(taskId))}`,
          { cause: error },
        ),
  );
}

function scheduleCloseIdle() {
  if (sweepTimer || OPEN.size <= MAX_IDLE_OPEN) {
    return;
  }
  sweepTimer = setTimeout(closeIdle, IDLE_MS);
  sweepTimer.unref();
}

function startOpen(taskId: TaskId): Promise<OpenStore> {
  const database = createDatabase(
    sqlite({ path: sessionStorePath(taskDir(taskId)) }),
  );

  const storage = createStorage({
    driver: dbDriver({
      database,
      tableName: "sessions",
    }),
  });

  // Perform a read to ensure storage is actually usable before caching
  const opened = ResultAsync.fromPromise(
    storage.getItem(`__canary__`),
    (error) =>
      new TypedError.Storage(
        `Failed to read session database at ${sessionStorePath(taskDir(taskId))}`,
        { cause: error },
      ),
  )
    .andThen(() => {
      const wrappedStorage = wrapStorage(storage);
      if (PREPARED.has(taskId)) {
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
          // started, which the cache miss guarantees. A sweep that fails
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
            `Failed to migrate session database at ${sessionStorePath(taskDir(taskId))}`,
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
      OPEN.set(taskId, open);
      PREPARED.add(taskId);
      scheduleCloseIdle();
      return open;
    });

  const promise = (async () => {
    try {
      const result = await opened;
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    } finally {
      OPENING.delete(taskId);
    }
  })();
  OPENING.set(taskId, promise);
  return promise;
}
