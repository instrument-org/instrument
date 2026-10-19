import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CHAT_DB_FILE_NAME } from "../constants";
import { makeActivityTable } from "./activity/store";
import {
  entryExists,
  isDirectorySync,
  moveEntrySync,
  removeEntrySync,
} from "./move-entry";
import { STORE_TABLE } from "./store-table";
import { openWorkspaceDb } from "./workspace-db";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

/** The folder earlier builds kept the workspace's index in, `index/chats.db`, in its machine folder. */
const FORMER_INDEX_DIR = "index";

/** The file earlier builds kept the activity log in, in the workspace's `.instrument/`. */
const FORMER_ACTIVITY_FILE = "ai-usage.db";

/** The columns of the activity log its former file's `requests` table shares with the index. */
const ACTIVITY_COLUMNS = [
  "id",
  "started_at",
  "duration_ms",
  "status",
  "error",
  "finish_reason",
  "kind",
  "purpose",
  "session_id",
  "chat_id",
  "surface",
  "connection_type",
  "connection_name",
  "model_requested",
  "model_served",
  "response_id",
  "input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
].join(", ");

/** A SQLite file's companions, which go wherever it goes. */
const SQLITE_SIDECARS = ["-wal", "-shm", "-journal"];

/**
 * A store's own bookkeeping, as against what it records: the migration
 * marker (`__migration_version__`), which is all the window's store held
 * once its tabs stopped reading their pages from it.
 */
const BOOKKEEPING_KEY = /^__\w+__$/;

/**
 * What one launch did to bring `workspace.db` together, one line per step
 * for the log, and how many steps failed and wait for the next launch.
 */
export interface WorkspaceDbSettled {
  done: string[];
  failed: number;
}

/**
 * Brings what earlier builds kept elsewhere into the workspace's
 * `workspace.db`, at launch, before the workspace opens it:
 *
 * - The activity log's rows move in from `.instrument/ai-usage.db`, and the
 *   file goes once every row is in. A file that cannot be read stays for
 *   the next launch.
 * - The index folder goes, since the index is rebuilt from the chats.
 * - The window's record folder, `.instrument/window/`, goes: the window
 *   keeps its scope but no records. Its store goes when it holds only its
 *   own bookkeeping; anything else in the folder, such a store included, is
 *   set aside in the workspace's `.pre-chats/window/` rather than deleted.
 *
 * Synchronous, and safe to run on every launch: what is already done is a
 * few stats.
 */
export function settleWorkspaceDb({
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): WorkspaceDbSettled {
  const settled: WorkspaceDbSettled = { done: [], failed: 0 };
  const file = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.database);
  let database: DatabaseSync | undefined;
  try {
    const opened = openWorkspaceDb(file);
    database = opened.database;
    if (opened.movedAside) {
      settled.done.push(
        `moved aside ${file}, which SQLite could not read, to ${opened.movedAside}`,
      );
    }
  } catch (error) {
    settled.failed++;
    settled.done.push(`could not open ${file} (${String(error)})`);
  }

  if (database) {
    const activityFile = path.join(
      workspaceLayout(rootDir).dataDir,
      FORMER_ACTIVITY_FILE,
    );
    const into = database;
    if (entryExists(activityFile)) {
      step(settled, `move the activity log in from ${activityFile}`, () => {
        moveActivityIn(into, activityFile, settled);
      });
    }
    database.close();
  }

  const formerIndex = path.join(machineDir, FORMER_INDEX_DIR);
  if (entryExists(formerIndex)) {
    step(settled, `remove ${formerIndex}`, () => {
      removeEntrySync(formerIndex);
      settled.done.push(`removed ${formerIndex}, which workspace.db replaces`);
    });
  }

  const layout = workspaceLayout(rootDir);
  if (isDirectorySync(layout.windowDir)) {
    removeWindowRecords({
      dir: layout.windowDir,
      setAsideDir: path.join(layout.setAsideDir, WORKSPACE_DATA_ENTRIES.window),
      settled,
    });
  }
  return settled;
}

/**
 * Empties the window's former record folder and removes it: a store holding
 * nothing but its bookkeeping is deleted, and every other entry is set
 * aside. An entry whose place aside is taken stays, and with it the folder,
 * for the next launch.
 */
function removeWindowRecords({
  dir,
  setAsideDir,
  settled,
}: {
  dir: string;
  setAsideDir: string;
  settled: WorkspaceDbSettled;
}): void {
  const store = path.join(dir, CHAT_DB_FILE_NAME);
  if (entryExists(store) && holdsOnlyBookkeeping(store)) {
    step(settled, `remove ${store}`, () => {
      for (const suffix of [...SQLITE_SIDECARS, ""]) {
        removeEntrySync(`${store}${suffix}`);
      }
      settled.done.push(`removed ${store}, which held no records`);
    });
  }
  for (const name of fs.readdirSync(dir)) {
    const from = path.join(dir, name);
    const to = path.join(setAsideDir, name);
    if (entryExists(to)) {
      settled.failed++;
      settled.done.push(`left ${from}: ${to} is already there`);
      continue;
    }
    step(settled, `set aside ${from}`, () => {
      fs.mkdirSync(setAsideDir, { recursive: true });
      moveEntrySync(from, to);
      settled.done.push(`set aside ${from} in ${setAsideDir}`);
    });
  }
  step(settled, `remove ${dir}`, () => {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      settled.done.push(`removed ${dir}, the window's former record folder`);
    }
  });
}

/**
 * Whether a store holds no rows but its own bookkeeping. A store SQLite
 * cannot read holds something unknown.
 */
function holdsOnlyBookkeeping(file: string): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(file);
    const hasTable = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(STORE_TABLE);
    if (!hasTable) {
      return true;
    }
    return database
      .prepare(`SELECT key FROM ${STORE_TABLE}`)
      .all()
      .every(
        (row) => typeof row.key === "string" && BOOKKEEPING_KEY.test(row.key),
      );
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

/**
 * Copies every row of the former activity file into the activity table, a
 * row already there by its id staying as it is, and removes the file once
 * the table holds every one of its rows. A launch cut short before the
 * removal copies nothing new the next time and removes it then.
 */
function moveActivityIn(
  database: DatabaseSync,
  file: string,
  settled: WorkspaceDbSettled,
): void {
  makeActivityTable(database);
  database.prepare("ATTACH DATABASE ? AS former").run(file);
  let moved: { missing: number; rows: number };
  try {
    const hasTable = database
      .prepare(
        "SELECT 1 FROM former.sqlite_master WHERE type = 'table' AND name = 'requests'",
      )
      .get();
    moved = hasTable ? copyActivity(database) : { missing: 0, rows: 0 };
  } finally {
    database.exec("DETACH DATABASE former");
  }
  if (moved.missing !== 0) {
    throw new Error(
      `${moved.missing.toString()} of its ${moved.rows.toString()} rows did not arrive`,
    );
  }
  for (const suffix of ["-wal", "-shm", "-journal", ""]) {
    removeEntrySync(`${file}${suffix}`);
  }
  settled.done.push(
    `moved ${moved.rows.toString()} activity rows in from ${file} and removed it`,
  );
}

/** Copies the attached former table's rows in, and counts those the activity table still lacks. */
function copyActivity(database: DatabaseSync): {
  missing: number;
  rows: number;
} {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(
      `INSERT OR IGNORE INTO main.activity (${ACTIVITY_COLUMNS}) SELECT ${ACTIVITY_COLUMNS} FROM former.requests`,
    );
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
  const count = (sql: string) => {
    const row = database.prepare(sql).get();
    if (typeof row?.count !== "number") {
      throw new Error(`No count from ${sql}`);
    }
    return row.count;
  };
  return {
    missing: count(
      "SELECT COUNT(*) AS count FROM former.requests WHERE id NOT IN (SELECT id FROM main.activity)",
    ),
    rows: count("SELECT COUNT(*) AS count FROM former.requests"),
  };
}

/** Runs one step, counting it as failed and saying why when it throws. */
function step(settled: WorkspaceDbSettled, what: string, run: () => void) {
  try {
    run();
  } catch (error) {
    settled.failed++;
    settled.done.push(`could not ${what} (${String(error)})`);
  }
}
