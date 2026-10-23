import fs from "node:fs";
import path from "node:path";
import superjson from "superjson";

import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { cacheByChatGeneration } from "./chat-generation";
import { chatDir } from "./record-folders";
import { writingChatRecords } from "./records/chat-records";
import { parseRecordFileName } from "./records/file-names";
import { getWorkspaceConfig } from "./workspace-config";
import { versionMatches, workspaceTables } from "./workspace-db";

/**
 * The shape of what the index holds. Any change to a table, or to the value a
 * row carries, bumps this, including a change to how a value is derived: a
 * release that leaves it alone reads the rows an earlier one wrote. An index
 * built under another version is thrown away and rebuilt from the records as it
 * is read: the index is derived, so it is never migrated. Its tables are in `workspace.db`, beside tables it never touches.
 */
const INDEX_VERSION = 16;

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
 * in the index, by how much of each of the chat's files it was read from.
 * Only a value whose session has moved is computed again, and one the
 * computation marks `unkept` is kept in neither place.
 *
 * A row's stamp says what its value was read from, never merely what the
 * files held around the time: for a chat held in memory, how far its fold has
 * read each file; for one that is not, each file's size, which is how far a
 * fold of it reads. A value is kept only when that stamp is the same before
 * and after it is computed, so nothing landed or folded in meanwhile, and
 * no row is read or kept while the chat has writes not yet in its files,
 * since a read then answers from those writes.
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
      const before = await stampOf(chatId);
      if (before === WRITING) {
        return compute();
      }
      // Checked again, since a write may have started while the files were read.
      if (before !== undefined && stampHeld(chatId) !== WRITING) {
        const row = guarded(() => indexTables()?.read.get(table)?.get(key));
        if (row?.stamp === before && typeof row.value === "string") {
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
      const after = await stampOf(chatId);
      if (derived.keep && typeof after === "string" && after === before) {
        guarded(() =>
          indexTables()
            ?.write.get(table)
            ?.run(key, after, superjson.stringify(derived.value)),
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

/** The version an index must carry to be read: the shape of what it holds. */
function expectedVersion(): string {
  return String(INDEX_VERSION);
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

/** A chat with writes not yet in its files, whose reads no row stands for. */
const WRITING = Symbol("writing");

/**
 * What a value read of the chat now is read from, as one string a row can
 * compare: every log and settings file and how much of it is read. Undefined
 * for a chat with no record file at all, or one a file of which could not be
 * looked at, since there is then nothing for a row to stand for.
 */
async function stampOf(
  chatId: ChatId,
): Promise<string | typeof WRITING | undefined> {
  return stampHeld(chatId) ?? (await filesStamp(chatDir(chatId)));
}

/** The stamp of the chat as held in memory, or null for a chat not held. */
function stampHeld(chatId: ChatId): string | typeof WRITING | null {
  const records = writingChatRecords();
  if (records?.isWriting(chatId)) {
    return WRITING;
  }
  const readTo = records?.readTo(chatId);
  return readTo ? (stampFrom([...readTo]) ?? null) : null;
}

/** The stamp of a chat no one holds: each file read to its end. */
async function filesStamp(dir: string): Promise<string | undefined> {
  const names = await fs.promises.readdir(dir).catch(() => undefined);
  const records = names?.filter(
    (name) => parseRecordFileName(name) !== undefined,
  );
  if (!records) {
    return undefined;
  }
  const sizes = await Promise.all(
    records.map((name) =>
      fs.promises.stat(path.join(dir, name)).then(
        ({ size }): [string, number] => [name, size],
        () => undefined,
      ),
    ),
  );
  return sizes.every((size) => size !== undefined)
    ? stampFrom(sizes)
    : undefined;
}

function stampFrom(files: [string, number][]): string | undefined {
  return files.length === 0
    ? undefined
    : files
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, size]) => `${name}:${size}`)
        .join("|");
}
