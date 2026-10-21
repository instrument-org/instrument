import { createDatabase } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";

import { STORE_TABLE } from "../../lib/store-table";
import { type WrappedStorage, wrapStorage } from "../../lib/wrap-storage";

/**
 * Opens the `chat.db` at `file` through the driver the 1.x converter's
 * `readChatDb` reads one with, hands it to `use`, and closes it again.
 */
export async function withChatDb<T>(
  file: string,
  use: (storage: WrappedStorage) => Promise<T>,
): Promise<T> {
  const database = createDatabase(sqlite({ path: file }));
  const storage = wrapStorage(
    createStorage({ driver: dbDriver({ database, tableName: STORE_TABLE }) }),
  );
  try {
    return await use(storage);
  } finally {
    // Unstorage's db0 driver never closes the database it was given.
    (await database.getInstance()).close();
    await storage.dispose();
  }
}
