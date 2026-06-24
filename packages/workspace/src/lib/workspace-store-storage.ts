import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import { type Connector, createDatabase, type Database } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { okAsync, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { type DatabaseSync } from "node:sqlite";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";

import { WORKSPACE_DB_FILE_NAME } from "../constants";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getWorkspaceConfig } from "./workspace-config";
import { type WrappedStorage, wrapStorage } from "./wrap-storage";

// The workspace store is a single, long-lived KV store at the workspace root's
// `.instrument/` private dir. Unlike the per-task session store there is exactly
// one per workspace, so we cache a single instance (keyed by its resolved path
// so tests pointing the singleton at a tmp dir get a fresh store).
let CACHED_STORAGE: undefined | WrappedStorage;
let CACHED_PATH: string | undefined;
let CACHED_DATABASE: Database<Connector<DatabaseSync>> | undefined;

// Closes the underlying SQLite handle and clears the cache. Primarily for tests
// that create throwaway workspaces; unstorage's db0 driver does not close the
// database on dispose, so we do it explicitly.
export function disposeWorkspaceStoreStorage() {
  return ResultAsync.fromPromise(
    (async () => {
      if (CACHED_DATABASE) {
        const instance = await CACHED_DATABASE.getInstance();
        instance.close();
      }
      if (CACHED_STORAGE) {
        await CACHED_STORAGE.dispose();
      }
      CACHED_STORAGE = undefined;
      CACHED_PATH = undefined;
      CACHED_DATABASE = undefined;
    })(),
    (error) =>
      new TypedError.Storage(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

export function getWorkspaceStoreStorage() {
  const { dbPath, privateDir } = workspaceStorePath();

  if (CACHED_STORAGE && CACHED_PATH === dbPath) {
    return okAsync(CACHED_STORAGE);
  }

  return ResultAsync.fromPromise(
    fs.mkdir(privateDir, { recursive: true }),
    (error) =>
      new TypedError.Storage(`Failed to create ${privateDir}`, {
        cause: error,
      }),
  ).andThen(() => {
    const database = createDatabase(sqlite({ path: dbPath }));

    const storage = createStorage({
      driver: dbDriver({
        database,
        tableName: "workspace",
      }),
    });

    // Perform a read to ensure the store is usable before caching it.
    return ResultAsync.fromPromise(
      storage.getItem(`__canary__`),
      (error) =>
        new TypedError.Storage(
          `Failed to read workspace database at ${dbPath}`,
          {
            cause: error,
          },
        ),
    ).map(() => {
      const wrappedStorage = wrapStorage(storage);
      CACHED_STORAGE = wrappedStorage;
      CACHED_PATH = dbPath;
      CACHED_DATABASE = database;
      return wrappedStorage;
    });
  });
}

function workspaceStorePath() {
  const privateDir = absolutePathJoin(
    getWorkspaceConfig().rootDir,
    TASK_PRIVATE_FOLDER_NAME,
  );
  return {
    dbPath: absolutePathJoin(privateDir, WORKSPACE_DB_FILE_NAME),
    privateDir,
  };
}
