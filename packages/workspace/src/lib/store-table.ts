import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";

import { type StoreWrite } from "./wrap-storage";

/**
 * The table a chat's `chat.db` keeps every row in, keyed by `StorageKey`.
 * The store reaches it through unstorage's db0 driver, which makes it on
 * first use with `STORE_TABLE_SCHEMA`.
 */
export const STORE_TABLE = "sessions";

/**
 * The statement the db0 driver makes the table with on SQLite, for code that
 * writes a database before the store has opened it.
 */
const STORE_TABLE_SCHEMA = `CREATE TABLE IF NOT EXISTS ${STORE_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT,
  blob BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`;

/**
 * Writes rows into a record's database the way the store writes them, in one
 * transaction, without opening the store: for the boot conversions, which
 * run before any store is open and cannot wait. Each value goes in as
 * superjson text in the `blob` column, which is what the store's raw reads
 * parse; bytes there are a row the store cannot read back.
 */
export function writeStoreRowsSync(
  dbPath: string,
  rows: readonly (readonly [key: string, value: unknown])[],
): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(STORE_TABLE_SCHEMA);
    const insert = db.prepare(
      `insert or replace into ${STORE_TABLE} (key, blob) values (?, ?)`,
    );
    db.exec("BEGIN");
    try {
      for (const [key, value] of rows) {
        insert.run(key, superjson.stringify(value));
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * Writes a batch of rows into an open chat database in one transaction, the
 * way unstorage's db0 driver writes one: a value goes in the `blob` column,
 * with the row's `updated_at` moved. Synchronous, so no other statement on
 * the connection runs inside the transaction.
 */
export function writeStoreRows(
  db: DatabaseSync,
  writes: readonly StoreWrite[],
): void {
  const upsert = db.prepare(
    `INSERT INTO ${STORE_TABLE} (key, blob, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = CURRENT_TIMESTAMP`,
  );
  const remove = db.prepare(`DELETE FROM ${STORE_TABLE} WHERE key = ?`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const write of writes) {
      if ("remove" in write) {
        remove.run(write.key);
      } else {
        upsert.run(write.key, write.value);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}
