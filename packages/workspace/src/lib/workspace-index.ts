import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import superjson from "superjson";

import { type TaskId } from "../schemas/task-id";
import { cacheByStoreGeneration } from "./store-generation";
import { sessionStorePath, taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * The shape of what the index holds. Any change to a table, or to the value a
 * row carries, bumps this, and an index built under another version is thrown
 * away and rebuilt from the stores as it is read: the index is derived, so it
 * is never migrated.
 */
const INDEX_VERSION = 1;

/**
 * What the index keeps, one row per chat or task: each a value derived from
 * that record's own store, and the stamp of the store it was derived from.
 */
export type IndexTable =
  | "chat_digests"
  | "linked_files"
  | "task_apps"
  | "task_hosts"
  | "task_standings";

const TABLES: IndexTable[] = [
  "chat_digests",
  "linked_files",
  "task_apps",
  "task_hosts",
  "task_standings",
];

interface OpenIndex {
  database: DatabaseSync;
  read: Map<IndexTable, StatementSync>;
  root: string;
  write: Map<IndexTable, StatementSync>;
}

/** The open index of the workspace being served, or null once opening it has failed. */
let opened: null | OpenIndex | undefined;

/** Closes the index, so the next read opens it again: a workspace switched, or a test done. */
export function closeWorkspaceIndex() {
  if (opened) {
    opened.database.close();
  }
  opened = undefined;
}

/**
 * A value derived from a task's store, kept until that store changes: in
 * memory by the store's write count, which every write in this process moves,
 * and across launches in the index, by the store's files' sizes and
 * modification times, which also move for a write made while the app was
 * closed. Only a value whose store has moved is computed again.
 *
 * `files` names what else the value is read from besides the task's store,
 * such as its settings, so a change to them is seen across launches too.
 */
export function indexedByStore<Value>(
  table: IndexTable,
  {
    files = () => [],
    inMemory = true,
  }: {
    files?: (taskId: TaskId) => string[];
    /**
     * Whether to also keep the value in memory by the store's write count.
     * Off for a value read from more than the store, which a write elsewhere
     * changes without moving that count; its caller keeps it in memory by
     * whatever does announce those writes.
     */
    inMemory?: boolean;
  } = {},
) {
  const memory = cacheByStoreGeneration<Value>();
  const read = (taskId: TaskId, compute: () => Promise<Value>) => async () => {
    // Taken before the value is computed: a write that lands meanwhile
    // leaves a stamp older than the store, which only costs a recompute.
    const stamp = await stampOf([
      sessionStorePath(taskDir(taskId)),
      `${sessionStorePath(taskDir(taskId))}-wal`,
      ...files(taskId),
    ]);
    const index = stamp === undefined ? undefined : openIndex();
    if (index && stamp !== undefined) {
      const row = index.read.get(table)?.get(taskId);
      if (row?.stamp === stamp && typeof row.value === "string") {
        try {
          return superjson.parse<Value>(row.value);
        } catch {
          // A row that will not parse is derived again, like a stale one.
        }
      }
    }
    const value = await compute();
    if (index && stamp !== undefined) {
      index.write.get(table)?.run(taskId, stamp, superjson.stringify(value));
    }
    return value;
  };
  return (taskId: TaskId, compute: () => Promise<Value>): Promise<Value> =>
    inMemory ? memory(taskId, read(taskId, compute)) : read(taskId, compute)();
}

/** The index file for a workspace: one per workspace root, named by a hash of it. */
function indexPath(indexesDir: string, rootDir: string): string {
  const name = createHash("sha256").update(rootDir).digest("hex").slice(0, 16);
  return path.join(indexesDir, `${name}.db`);
}

function open(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  database.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
  );
  const version = database
    .prepare("SELECT value FROM meta WHERE key = 'version'")
    .get();
  if (version?.value !== String(INDEX_VERSION)) {
    for (const table of TABLES) {
      database.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    database
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(INDEX_VERSION));
  }
  for (const table of TABLES) {
    database.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, value TEXT NOT NULL) STRICT`,
    );
  }
  return database;
}

/**
 * The workspace's index, opened on first use. One that cannot be opened is
 * deleted and built again; one that still cannot is left off for the rest of
 * the process, and every read derives from the stores as it would without one.
 */
function openIndex(): OpenIndex | undefined {
  if (!hasWorkspaceConfig()) {
    return undefined;
  }
  const { indexesDir, rootDir } = getWorkspaceConfig();
  if (!indexesDir) {
    return undefined;
  }
  if (opened !== undefined && opened?.root !== rootDir) {
    closeWorkspaceIndex();
  }
  if (opened === null) {
    return undefined;
  }
  if (opened) {
    return opened;
  }
  const file = indexPath(indexesDir, rootDir);
  let database: DatabaseSync;
  try {
    database = open(file);
  } catch (error) {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${file}${suffix}`, { force: true });
      }
      database = open(file);
    } catch {
      getWorkspaceConfig().captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
      opened = null;
      return undefined;
    }
  }
  opened = {
    database,
    read: new Map(
      TABLES.map((table) => [
        table,
        database.prepare(`SELECT stamp, value FROM ${table} WHERE id = ?`),
      ]),
    ),
    root: rootDir,
    write: new Map(
      TABLES.map((table) => [
        table,
        database.prepare(
          `INSERT INTO ${table} (id, stamp, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET stamp = excluded.stamp, value = excluded.value`,
        ),
      ]),
    ),
  };
  return opened;
}

/**
 * The sizes and modification times of a value's files, as one string; a
 * missing file stamps as missing. Undefined when the first, the store itself,
 * is not there, since there is then nothing for a row to stand for.
 */
async function stampOf(files: string[]): Promise<string | undefined> {
  const stats = await Promise.allSettled(
    files.map((file) => fs.promises.stat(file)),
  );
  if (stats[0]?.status !== "fulfilled") {
    return undefined;
  }
  return stats
    .map((stat) =>
      stat.status === "fulfilled"
        ? `${stat.value.size}:${stat.value.mtimeMs}`
        : "-",
    )
    .join("|");
}
