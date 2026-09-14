import { type Connector, createDatabase, type Database } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { type DatabaseSync } from "node:sqlite";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";

import { type TaskId } from "../schemas/task-id";
import { TypedError } from "./errors";
import { sweepInterruptedToolCalls } from "./interrupted-tool-calls";
import { runStoreMigrations } from "./store-migrations";
import { sessionStorePath, taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";
import { type WrappedStorage, wrapStorage } from "./wrap-storage";

// Avoids possible SQLite database lock errors if we create the same storage
// multiple times.
const STORAGE_CACHE = new Map<TaskId, WrappedStorage>();

// Maps storage instances to their underlying database instances for proper cleanup
// We have to do this because Unstorage doesn't call `database.close()` with
// their db0 driver currently.
const STORAGE_TO_DATABASE = new WeakMap<
  WrappedStorage,
  Database<Connector<DatabaseSync>>
>();

// Tracks storages that are currently being disposed to prevent recreation
const DISPOSING_STORAGES = new Set<TaskId>();

export function disposeSessionsStoreStorage(id: TaskId) {
  return ResultAsync.fromPromise(
    (async () => {
      const storage = STORAGE_CACHE.get(id);
      if (storage) {
        const database = STORAGE_TO_DATABASE.get(storage);
        if (database) {
          const instance = await database.getInstance();
          instance.close();
          STORAGE_TO_DATABASE.delete(storage);
        }
        await storage.dispose();
        STORAGE_CACHE.delete(id);
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
  )
    .andThen(() => {
      if (DISPOSING_STORAGES.has(taskId)) {
        return err(
          new TypedError.Storage(
            `Cannot create storage for ${taskId} while it is being deleted`,
          ),
        );
      }

      const existingStorage = STORAGE_CACHE.get(taskId);
      if (existingStorage) {
        return ok(existingStorage);
      }

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
      return ResultAsync.fromPromise(
        storage.getItem(`__canary__`),
        (error) =>
          new TypedError.Storage(
            `Failed to read session database at ${sessionStorePath(taskDir(taskId))}`,
            { cause: error },
          ),
      )
        .andThen(() => {
          const wrappedStorage = wrapStorage(storage);
          // Before the storage is cached, so nothing can read through it until
          // its data matches what this build expects. Caching after also means
          // this runs once per task per process rather than per read.
          return runStoreMigrations({ storage: wrappedStorage }).map(
            () => wrappedStorage,
          );
        })
        .andThen((wrappedStorage) => {
          // Also before caching, and for a stronger reason than cost: a tool
          // call still marked in flight belongs to a process that is gone,
          // and that is only certain while no run of this process can have
          // started, which the cache miss guarantees. A sweep that fails
          // leaves the parts as they were, which is no worse than not
          // sweeping; opening the task is not held to it.
          return sweepInterruptedToolCalls({ storage: wrappedStorage })
            .orElse((error) => {
              if (hasWorkspaceConfig()) {
                getWorkspaceConfig().captureException(error);
              } else {
                // A script reading a task outside the app has nowhere else
                // to report to.
                // eslint-disable-next-line no-console
                console.error("Failed to sweep interrupted tool calls", error);
              }
              return ok(undefined);
            })
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
          STORAGE_TO_DATABASE.set(wrappedStorage, database);
          STORAGE_CACHE.set(taskId, wrappedStorage);
          return wrappedStorage;
        });
    })
    .orTee(() => {
      STORAGE_CACHE.delete(taskId);
    });
}

export function markStorageAsDisposing(id: TaskId) {
  DISPOSING_STORAGES.add(id);
}

export function unmarkStorageAsDisposing(id: TaskId) {
  DISPOSING_STORAGES.delete(id);
}
