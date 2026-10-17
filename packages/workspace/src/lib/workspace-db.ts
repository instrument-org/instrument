import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * `workspace.db`, the one SQLite database this computer keeps for a
 * workspace, at the top of the workspace's machine folder: never in the
 * workspace, which a sync engine may carry mid-write. It holds the index,
 * which is rebuilt from the workspace's records whenever its tables'
 * version changes, and what exists nowhere else: the activity log.
 *
 * Each module that keeps tables here makes them on first use
 * (`workspaceTables`), and keeps the version they were made under in `meta`
 * by its own name (`versionMatches`), so a change to one module's tables
 * never touches another's.
 */

/** The open database of the workspace being served, or null once opening it has failed. */
let opened: null | { database: DatabaseSync; file: string } | undefined;

/** The file opening failed for, so a later workspace's file is tried afresh. */
let failedFile: string | undefined;

/** Whether a failure to open the database or make tables in it has been reported this process. */
let reported = false;

/**
 * Opens the database at `file`, making it and its folder where they are
 * missing. A file SQLite says is no database it can read is moved aside
 * beside itself and the database made again, which loses what only it held:
 * the activity log, which nothing depends on. Throws for any other failure
 * (another process holding a lock, a full disk), which leaves the file as it
 * is.
 */
export function openWorkspaceDb(file: string): {
  database: DatabaseSync;
  /** Where an unreadable file went, when one was moved aside. */
  movedAside?: string;
} {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    return { database: open(file) };
  } catch (error) {
    if (!isUnreadableFile(error)) {
      throw error;
    }
  }
  const aside = `${file}.unreadable-${Date.now().toString()}`;
  // The write-ahead log and its index go with it: left beside a new file,
  // SQLite would apply the old file's pages to it.
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`${file}${suffix}`)) {
      fs.renameSync(`${file}${suffix}`, `${aside}${suffix}`);
    }
  }
  return { database: open(file), movedAside: aside };
}

/**
 * The served workspace's database, opened on first use, or none where there
 * is nowhere to keep one (tests and scripts with no `workspaceDbFile`) or
 * opening it failed, which is reported once and leaves it closed for the
 * rest of the process.
 */
function workspaceDb(): DatabaseSync | undefined {
  if (!hasWorkspaceConfig()) {
    return undefined;
  }
  const file = getWorkspaceConfig().workspaceDbFile;
  if (!file) {
    return undefined;
  }
  if (opened && opened.file !== file) {
    closeWorkspaceDb();
  }
  if (opened === null && failedFile === file) {
    return undefined;
  }
  if (opened) {
    return opened.database;
  }
  try {
    const { database, movedAside } = openWorkspaceDb(file);
    if (movedAside) {
      getWorkspaceConfig().captureException(
        new Error(`Moved aside a workspace.db SQLite could not read`),
      );
    }
    opened = { database, file };
    return database;
  } catch (error) {
    report("The workspace's database could not be opened", error);
    opened = null;
    failedFile = file;
    return undefined;
  }
}

/** Closes the database, so the next use opens it again: a workspace switched, or a test done. */
export function closeWorkspaceDb(): void {
  opened?.database.close();
  opened = undefined;
  failedFile = undefined;
}

/**
 * A module's tables in the served workspace's database: `setUp` makes them
 * and answers with what the module reads them through, once per open
 * database. None where there is no database, or where `setUp` threw, which
 * is reported and leaves that module's tables alone for as long as the
 * database stays open.
 */
export function workspaceTables<T>(
  setUp: (database: DatabaseSync) => T,
): () => T | undefined {
  const made = new WeakMap<DatabaseSync, { value: T } | null>();
  return () => {
    const database = workspaceDb();
    if (!database) {
      return undefined;
    }
    const known = made.get(database);
    if (known !== undefined) {
      return known?.value;
    }
    try {
      const value = setUp(database);
      made.set(database, { value });
      return value;
    } catch (error) {
      report("Tables in the workspace's database could not be made", error);
      made.set(database, null);
      return undefined;
    }
  };
}

/**
 * Whether the tables kept under `name` were made at `version`. When they
 * were not, `version` is recorded as theirs, and the caller makes them
 * again in the same transaction.
 */
export function versionMatches(
  database: DatabaseSync,
  name: string,
  version: number | string,
): boolean {
  const row = database
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(name);
  if (row?.value === String(version)) {
    return true;
  }
  database
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(name, String(version));
  return false;
}

function open(file: string): DatabaseSync {
  const database = new DatabaseSync(file);
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    `);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

/**
 * Whether SQLite said the file is not a database it can read: the one
 * failure that moving it aside fixes.
 */
function isUnreadableFile(error: unknown): boolean {
  if (!(error instanceof Error) || !("errcode" in error)) {
    return false;
  }
  const primary = Number(error.errcode) & 0xff;
  // SQLITE_CORRUPT and SQLITE_NOTADB.
  return primary === 11 || primary === 26;
}

function report(what: string, error: unknown): void {
  if (reported) {
    return;
  }
  reported = true;
  getWorkspaceConfig().captureException(new Error(what, { cause: error }));
}
