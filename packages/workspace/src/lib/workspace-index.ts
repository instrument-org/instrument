import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import superjson from "superjson";

import { type ChatId } from "../schemas/chat-id";
import { cacheByStoreGeneration } from "./store-generation";
import { STORE_MIGRATION_COUNT } from "./store-migrations";
import { sessionStorePath } from "./chat-dir-utils";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * The shape of what the index holds. Any change to a table, or to the value a
 * row carries, bumps this. An index built under another version, by another
 * release, or against stores of another migration count is thrown away and
 * rebuilt from the stores as it is read: the index is derived, so it is never
 * migrated.
 */
const INDEX_VERSION = 4;

/**
 * What the index keeps, one row per chat or task: each a value derived from
 * the chat's store, and the stamp of the store it was derived from.
 */
export type IndexTable = "chat_digests" | "task_hosts" | "task_standings";

const TABLES: IndexTable[] = ["chat_digests", "task_hosts", "task_standings"];

/**
 * A derived value, and whether it may be kept. A value read around a failure
 * (a store that would not open, a record that would not parse) is still the
 * best answer for now, but keeping it would go on serving the failure until
 * something next writes the store, which for an idle chat may be never.
 */
export interface Derived<Value> {
  keep: boolean;
  value: Value;
}

interface OpenIndex {
  database: DatabaseSync;
  read: Map<IndexTable, StatementSync>;
  root: string;
  write: Map<IndexTable, StatementSync>;
}

/** A value read in full, which the index may keep. */
export function kept<Value>(value: Value): Derived<Value> {
  return { keep: true, value };
}

/** A value read around a failure, which is answered once and kept nowhere. */
export function unkept<Value>(value: Value): Derived<Value> {
  return { keep: false, value };
}

/** The open index of the workspace being served, or null once opening it has failed. */
let opened: null | OpenIndex | undefined;

/** Whether a failure to read or write the index has been reported this process. */
let reported = false;

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
 * closed. Only a value whose store has moved is computed again, and one the
 * computation marks `unkept` is kept in neither place.
 *
 * The index only ever speeds a read up: a row it cannot read or write is
 * derived as though it were absent.
 */
export function indexedByStore<Value>(table: IndexTable) {
  const memory = cacheByStoreGeneration<Derived<Value>>(
    (derived) => derived.keep,
  );
  const read =
    (chatId: ChatId, key: string, compute: () => Promise<Derived<Value>>) =>
    async (): Promise<Derived<Value>> => {
      // Taken before the value is computed: a write that lands meanwhile
      // leaves a stamp older than the store, which only costs a recompute.
      const stamp = await stampOf([
        sessionStorePath(chatDir(chatId)),
        `${sessionStorePath(chatDir(chatId))}-wal`,
      ]);
      if (stamp !== undefined) {
        const row = guarded(() => openIndex()?.read.get(table)?.get(key));
        if (row?.stamp === stamp && typeof row.value === "string") {
          const value = row.value;
          const parsed = guarded(() => ({
            value: superjson.parse<Value>(value),
          }));
          if (parsed) {
            return kept(parsed.value);
          }
        }
      }
      const derived = await compute();
      if (derived.keep && stamp !== undefined) {
        guarded(() =>
          openIndex()
            ?.write.get(table)
            ?.run(key, stamp, superjson.stringify(derived.value)),
        );
      }
      return derived;
    };
  /** `key` tells apart values derived from one store: a task's, by its session. */
  return async (
    chatId: ChatId,
    compute: () => Promise<Derived<Value>>,
    key: string = chatId,
  ): Promise<Value> => {
    const derived = await memory(chatId, read(chatId, key, compute), key);
    return derived.value;
  };
}

/** The version an index must carry to be read: this build's shape, release, and stores. */
function expectedVersion(): string {
  return `${INDEX_VERSION}:${getWorkspaceConfig().appVersion}:${STORE_MIGRATION_COUNT}`;
}

/**
 * Runs an index read or write, answering undefined if it throws: another
 * process holding a lock, a full disk, a damaged page. The first such failure
 * is reported; the read derives as though the index had no row.
 */
function guarded<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch (error) {
    if (!reported) {
      reported = true;
      getWorkspaceConfig().captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return undefined;
  }
}

/** The index file for a workspace: one per workspace root, named by a hash of it. */
function indexPath(indexesDir: string, rootDir: string): string {
  const name = createHash("sha256").update(rootDir).digest("hex").slice(0, 16);
  return path.join(indexesDir, `${name}.db`);
}

/**
 * Whether SQLite said the file is not a database it can read: the one failure
 * deleting it fixes. Anything else (another process holding a lock, a full
 * disk) leaves the file to whoever has it open.
 */
function isUnreadableFile(error: unknown): boolean {
  if (!(error instanceof Error) || !("errcode" in error)) {
    return false;
  }
  const primary = Number(error.errcode) & 0xff;
  // SQLITE_CORRUPT and SQLITE_NOTADB.
  return primary === 11 || primary === 26;
}

function open(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    database.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
    );
    const version = database
      .prepare("SELECT value FROM meta WHERE key = 'version'")
      .get();
    if (version?.value !== expectedVersion()) {
      for (const table of TABLES) {
        database.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      database
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(expectedVersion());
    }
    for (const table of TABLES) {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, value TEXT NOT NULL) STRICT`,
      );
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

/**
 * The workspace's index, opened on first use. One SQLite cannot read as a
 * database is deleted and built again; one that cannot be opened for any
 * other reason, or still cannot after that, is left off for the rest of the
 * process, and every read derives from the stores as it would without one.
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
    if (!isUnreadableFile(error)) {
      getWorkspaceConfig().captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
      opened = null;
      return undefined;
    }
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${file}${suffix}`, { force: true });
      }
      database = open(file);
    } catch (retryError) {
      getWorkspaceConfig().captureException(
        retryError instanceof Error
          ? retryError
          : new Error(String(retryError)),
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
