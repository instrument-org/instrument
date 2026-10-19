import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { getWorkspaceConfig } from "../workspace-config";
import { versionMatches, workspaceTables } from "../workspace-db";
import { type LogCursor } from "./record-writer";

/**
 * Where this device last left its newest log of each session, kept in
 * `workspace.db` on this computer: the log's name, its size, a hash of its
 * last bytes and its last `seq`. `openLog` checks the file against it before
 * appending, so a log a sync engine or a restored backup put back as an
 * older copy is never written on top of: the device starts its next log
 * instead, and the copy that had more is left for the sync engine to bring
 * back.
 *
 * A row is kept each time the log is synced to disk, so it may lag the file
 * (lines written since, or a crash before the row) but never run ahead of
 * what a crash leaves of it; `openLog` recognizes a file that grew past its
 * row. Where there
 * is no row, or no database, the device carries on in its newest log as it
 * finds it.
 */

/** The shape of the table. A change drops the rows, which costs only the check until each log is next written. */
const VERSION = 1;

const tables = workspaceTables((database) => {
  database.exec("BEGIN");
  try {
    if (!versionMatches(database, "own-log-cursors", VERSION)) {
      database.exec("DROP TABLE IF EXISTS own_log_cursors");
    }
    database.exec(
      "CREATE TABLE IF NOT EXISTS own_log_cursors (chat TEXT NOT NULL, session TEXT NOT NULL, name TEXT NOT NULL, last_seq INTEGER NOT NULL, size INTEGER NOT NULL, tail_hash TEXT NOT NULL, PRIMARY KEY (chat, session)) STRICT",
    );
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
  return {
    read: database.prepare(
      "SELECT name, last_seq, size, tail_hash FROM own_log_cursors WHERE chat = ? AND session = ?",
    ),
    write: database.prepare(
      "INSERT INTO own_log_cursors (chat, session, name, last_seq, size, tail_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (chat, session) DO UPDATE SET name = excluded.name, last_seq = excluded.last_seq, size = excluded.size, tail_hash = excluded.tail_hash",
    ),
  };
});

/** Where this device last left its newest log of the session, when it was kept. */
export function ownLogCursor(
  chat: ChatId,
  session: StoreId.Session,
): { cursor: LogCursor; name: string } | undefined {
  const row = guarded(() => tables()?.read.get(chat, session));
  if (
    typeof row?.name !== "string" ||
    typeof row.last_seq !== "number" ||
    typeof row.size !== "number" ||
    typeof row.tail_hash !== "string"
  ) {
    return undefined;
  }
  return {
    cursor: { lastSeq: row.last_seq, size: row.size, tailHash: row.tail_hash },
    name: row.name,
  };
}

/** Keeps where this device's write to its newest log of the session left it. */
export function keepOwnLogCursor(
  chat: ChatId,
  session: StoreId.Session,
  name: string,
  cursor: LogCursor,
): void {
  guarded(() =>
    tables()?.write.run(
      chat,
      session,
      name,
      cursor.lastSeq,
      cursor.size,
      cursor.tailHash,
    ),
  );
}

/** Whether a failure to read or write the table has been reported this process. */
let reported = false;

/**
 * Runs a read or write of the table, answering undefined if it throws: a
 * write it misses only skips the check for that log, and a write to the log
 * must not fail over it.
 */
function guarded<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch (error) {
    if (!reported) {
      reported = true;
      getWorkspaceConfig().captureException(
        new Error("This device's log cursors could not be read or kept", {
          cause: error,
        }),
      );
    }
    return undefined;
  }
}
