import fs from "node:fs";
import path from "node:path";
import superjson from "superjson";

import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { cacheByChatGeneration } from "./chat-generation";
import { STORE_MIGRATION_COUNT } from "./store-migrations";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";
import { versionMatches, workspaceTables } from "./workspace-db";

/**
 * The shape of what the index holds. Any change to a table, or to the value a
 * row carries, bumps this. An index built under another version, by another
 * release, or against stores of another migration count is thrown away and
 * rebuilt from the stores as it is read: the index is derived, so it is never
 * migrated. Its tables are in `workspace.db`, beside tables it never touches.
 */
const INDEX_VERSION = 12;

/**
 * What the index keeps, one row per session: each a value derived from that
 * session in its chat's store, and the stamp of the store it was derived from.
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

/** A value read in full, which the index may keep. */
export function kept<Value>(value: Value): Derived<Value> {
  return { keep: true, value };
}

/** A value read around a failure, which is answered once and kept nowhere. */
export function unkept<Value>(value: Value): Derived<Value> {
  return { keep: false, value };
}

/**
 * A value derived from one session in a chat's store, kept until it changes:
 * in memory by that session's write count, which every write to it in this
 * process moves and a write to another session does not, and across launches
 * in the index, by the store's files' sizes and modification times, which
 * also move for a write made while the app was closed. Only a value whose
 * session has moved is computed again, and one the computation marks
 * `unkept` is kept in neither place.
 *
 * The index only ever speeds a read up: a row it cannot read or write is
 * derived as though it were absent.
 */
export function indexedByRecords<Value>(table: IndexTable) {
  const memory = cacheByChatGeneration<Derived<Value>>(
    (derived) => derived.keep,
  );
  const read =
    (
      chatId: ChatId,
      key: StoreId.Session,
      compute: () => Promise<Derived<Value>>,
    ) =>
    async (): Promise<Derived<Value>> => {
      // Taken before the value is computed: an append that lands meanwhile
      // leaves a stamp older than the records, which only costs a recompute.
      const stamp = await recordsStamp(chatDir(chatId));
      if (stamp !== undefined) {
        const row = guarded(() => indexTables()?.read.get(table)?.get(key));
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
          indexTables()
            ?.write.get(table)
            ?.run(key, stamp, superjson.stringify(derived.value)),
        );
      }
      return derived;
    };
  return async (
    chatId: ChatId,
    sessionId: StoreId.Session,
    compute: () => Promise<Derived<Value>>,
  ): Promise<Value> => {
    const derived = await memory(
      chatId,
      sessionId,
      read(chatId, sessionId, compute),
    );
    return derived.value;
  };
}

/** The version an index must carry to be read: this build's shape, release, and stores. */
function expectedVersion(): string {
  return `${INDEX_VERSION}:${getWorkspaceConfig().appVersion}:${STORE_MIGRATION_COUNT}`;
}

/**
 * The index's tables in `workspace.db`, made on first use, and emptied when
 * they were made by another version. Where there is no database, or the
 * tables cannot be made, every read derives from the stores as it would
 * without an index.
 */
const indexTables = workspaceTables((database) => {
  database.exec("BEGIN");
  try {
    if (!versionMatches(database, "workspace-index", expectedVersion())) {
      for (const table of TABLES) {
        database.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    }
    for (const table of TABLES) {
      database.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, value TEXT NOT NULL) STRICT`,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
  return {
    read: new Map(
      TABLES.map((table) => [
        table,
        database.prepare(`SELECT stamp, value FROM ${table} WHERE id = ?`),
      ]),
    ),
    write: new Map(
      TABLES.map((table) => [
        table,
        database.prepare(
          `INSERT INTO ${table} (id, stamp, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET stamp = excluded.stamp, value = excluded.value`,
        ),
      ]),
    ),
  };
});

/** Whether a failure to read or write the index has been reported this process. */
let reported = false;

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
      getWorkspaceConfig().captureException(error);
    }
    return undefined;
  }
}

/**
 * The chat's records as one string a read can compare: every log and marks
 * file in its folder, with its size and modification time. Undefined for a
 * chat with no record file at all, since there is then nothing for a row to
 * stand for.
 */
async function recordsStamp(dir: string): Promise<string | undefined> {
  const names = await fs.promises.readdir(dir).catch(() => undefined);
  const records = names?.filter((name) => name.endsWith(".jsonl")).toSorted();
  if (!records || records.length === 0) {
    return undefined;
  }
  const stats = await Promise.allSettled(
    records.map((name) => fs.promises.stat(path.join(dir, name))),
  );
  return records
    .map((name, index) => {
      const stat = stats[index];
      return stat?.status === "fulfilled"
        ? `${name}:${stat.value.size}:${stat.value.mtimeMs}`
        : `${name}:-`;
    })
    .join("|");
}
