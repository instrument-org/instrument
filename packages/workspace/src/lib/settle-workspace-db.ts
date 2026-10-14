import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import path from "node:path";
import { type DatabaseSync } from "node:sqlite";

import { makeActivityTable } from "./ai-usage/store";
import { entryExists, removeEntrySync } from "./move-entry";
import { openWorkspaceDb } from "./workspace-db";
import { workspaceLayout } from "./workspace-layout";

/** The folder earlier builds kept the workspace's index in, `index/chats.db`, in its machine folder. */
const FORMER_INDEX_DIR = "index";

/** The file earlier builds kept the activity log in, in the workspace's `.instrument/`. */
const FORMER_ACTIVITY_FILE = "ai-usage.db";

/** The columns of the activity log, the same in its former file's `requests` table. */
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
  "connection_id",
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
  return settled;
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
