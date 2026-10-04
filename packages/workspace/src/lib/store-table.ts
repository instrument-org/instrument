import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";

/**
 * The table a record's `task.db` keeps every row in, keyed by `StorageKey`.
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
