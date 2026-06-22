import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import {
  STORE_DB_FILE_NAME,
  TASK_STATE_FILE_NAME,
  TASKS_DIR_NAME,
} from "../constants";

// Legacy on-disk names from the phase-1 layout that this migration moves away
// from. Kept as literals here (not constants) since the live code no longer
// references them.
const LEGACY_TASKS_DIR_NAME = "projects";
const LEGACY_STORE_DB_FILE_NAME = "sessions.db";
const LEGACY_STATE_FILE_NAME = "project-state.json";

// SQLite keeps sidecar files next to the db; they must travel with it. Empty
// suffix is the db file itself. Harmless if a given sidecar is absent.
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

export interface WorkspaceLayoutMigration {
  // Task folder ids left in place because a task with the same id already
  // existed under tasks/ (never clobbered).
  conflictedTaskIds: string[];
  // True when a legacy projects/ dir was found and processed.
  migrated: boolean;
  movedTaskCount: number;
}

// Idempotent boot migration from the phase-1 on-disk layout
// (projects/<id>/.instrument/{sessions.db,project-state.json}) to the task
// layout (tasks/<id>/.instrument/{store.db,state.json}).
//
// Keyed purely on the presence of a legacy projects/ dir, never a version
// number, so it re-runs if one ever reappears. Synchronous and rename-only:
// it runs once at boot before the workspace serves tasks, while no db handle
// is open.
export function migrateWorkspaceLayout({
  rootDir,
}: {
  rootDir: string;
}): WorkspaceLayoutMigration {
  const legacyDir = path.join(rootDir, LEGACY_TASKS_DIR_NAME);
  const migration: WorkspaceLayoutMigration = {
    conflictedTaskIds: [],
    migrated: false,
    movedTaskCount: 0,
  };

  if (!fs.existsSync(legacyDir)) {
    return migration;
  }
  migration.migrated = true;

  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  fs.mkdirSync(tasksDir, { recursive: true });

  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const source = path.join(legacyDir, entry.name);
    const destination = path.join(tasksDir, entry.name);

    if (fs.existsSync(destination)) {
      // A task with this id already lives under tasks/. Leave the legacy copy
      // entirely untouched rather than overwrite (or even mutate) potentially
      // newer data.
      migration.conflictedTaskIds.push(entry.name);
      continue;
    }

    // Rename per-task private files in place first, so a run interrupted after
    // this point (folder already moved) still leaves a consistent task.
    migrateTaskPrivateFiles(source);

    fs.renameSync(source, destination);
    migration.movedTaskCount += 1;
  }

  // Drop the legacy dir once every task folder has moved. Stray non-directory
  // entries (e.g. a macOS .DS_Store) keep it around — harmless, but the
  // (fast, rename-only) migration then re-runs every boot until they're gone.
  if (fs.readdirSync(legacyDir).length === 0) {
    fs.rmdirSync(legacyDir);
  }

  return migration;
}

function migrateTaskPrivateFiles(taskFolder: string) {
  const privateDir = path.join(taskFolder, TASK_PRIVATE_FOLDER_NAME);
  if (!fs.existsSync(privateDir)) {
    return;
  }

  for (const suffix of DB_FILE_SUFFIXES) {
    renameIfMissingTarget(
      path.join(privateDir, LEGACY_STORE_DB_FILE_NAME + suffix),
      path.join(privateDir, STORE_DB_FILE_NAME + suffix),
    );
  }

  renameIfMissingTarget(
    path.join(privateDir, LEGACY_STATE_FILE_NAME),
    path.join(privateDir, TASK_STATE_FILE_NAME),
  );
}

function renameIfMissingTarget(source: string, destination: string) {
  if (fs.existsSync(source) && !fs.existsSync(destination)) {
    fs.renameSync(source, destination);
  }
}
