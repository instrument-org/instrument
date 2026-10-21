import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CHAT_DB_FILE_NAME } from "../constants";
import {
  entryExists,
  isDirectorySync,
  moveEntrySync,
  removeEntrySync,
} from "./move-entry";
import { STORE_TABLE } from "./store-table";
import { openWorkspaceDb } from "./workspace-db";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

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
 * `workspace.db`, at launch, before the workspace opens it. The window's
 * record folder, `.instrument/window/`, goes: the window keeps its scope but
 * no records. Its store goes when it holds only its own bookkeeping;
 * anything else in the folder, such a store included, is set aside in the
 * workspace's `.pre-chats/window/` rather than deleted.
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
  try {
    const opened = openWorkspaceDb(file);
    opened.database.close();
    if (opened.movedAside) {
      settled.done.push(
        `moved aside ${file}, which SQLite could not read, to ${opened.movedAside}`,
      );
    }
  } catch (error) {
    settled.failed++;
    settled.done.push(`could not open ${file} (${String(error)})`);
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

/** Runs one step, counting it as failed and saying why when it throws. */
function step(settled: WorkspaceDbSettled, what: string, run: () => void) {
  try {
    run();
  } catch (error) {
    settled.failed++;
    settled.done.push(`could not ${what} (${String(error)})`);
  }
}
