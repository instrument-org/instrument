import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import {
  TASK_DB_FILE_NAME,
  TASK_FOLDER_NAMES,
  TASK_STATE_FILE_NAME,
  TASKS_DIR_NAME,
} from "../constants";

// Legacy on-disk names this migration renames to their current equivalents.
const LEGACY_TASKS_DIR_NAME = "projects";
const LEGACY_DB_FILE_NAME = "sessions.db";
const LEGACY_STATE_FILE_NAME = "project-state.json";
const LEGACY_SETTINGS_FILE_NAME = "instrument.json";
const LEGACY_ATTACHMENT_DIR_NAMES = ["user-provided", "agent-retrieved"];

// `.state` is intentionally not migrated: the task db stores direct path
// references to screenshots/bash-output under `.state/`, so moving the files
// would orphan them. It stays in place, still ignored by the file index.

// Root entries moved wholesale (rename) into `work/`. Anything absent is skipped.
const WORK_ENTRY_NAMES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "AGENTS.md",
  TASK_FOLDER_NAMES.skills,
  "src",
  "scripts",
  "tmp",
  "node_modules",
];

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

// Idempotent boot migration to the current task layout
// (tasks/<id>/{.instrument/{task.db,settings.json},work/,attachments/,output/}).
//
// Two independent passes: move a legacy projects/ dir to tasks/, then normalize
// every task already under tasks/ to the current layout. Keyed purely on the
// presence of legacy on-disk shapes, never a version number, so each piece
// re-runs if one ever reappears. Synchronous and rename-only: it runs once at
// boot before the workspace serves tasks, while no db handle is open.
export function migrateWorkspaceLayout({
  rootDir,
}: {
  rootDir: string;
}): WorkspaceLayoutMigration {
  const migration = migrateLegacyProjectsDir(rootDir);
  // Normalize every task under tasks/ -- including ones already there --
  // independent of whether a legacy projects/ dir existed.
  normalizeTasks(path.join(rootDir, TASKS_DIR_NAME));
  return migration;
}

// Moves every top-level entry of source into destination (per-entry, so a
// pre-existing destination is preserved), then removes source if it ends empty.
function mergeDirInto(source: string, destination: string) {
  if (!fs.existsSync(source)) {
    return;
  }
  for (const entry of fs.readdirSync(source)) {
    moveIfMissingTarget(
      path.join(source, entry),
      path.join(destination, entry),
    );
  }
  if (fs.readdirSync(source).length === 0) {
    fs.rmdirSync(source);
  }
}

function migrateLegacyProjectsDir(rootDir: string): WorkspaceLayoutMigration {
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

    fs.renameSync(source, destination);
    migration.movedTaskCount += 1;
  }

  // Drop the legacy dir once every task folder has moved. Stray non-directory
  // entries (e.g. a macOS .DS_Store) keep it around -- harmless, but the
  // (fast, rename-only) migration then re-runs every boot until they're gone.
  if (fs.readdirSync(legacyDir).length === 0) {
    fs.rmdirSync(legacyDir);
  }

  return migration;
}

function moveIfMissingTarget(source: string, destination: string) {
  if (fs.existsSync(source) && !fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
  }
}

// Folds legacy user-input dirs (user-provided/, agent-retrieved/) into a single
// attachments/ dir.
function normalizeTaskAttachments(taskFolder: string) {
  const attachmentsDir = path.join(taskFolder, TASK_FOLDER_NAMES.attachments);
  for (const legacyName of LEGACY_ATTACHMENT_DIR_NAMES) {
    mergeDirInto(path.join(taskFolder, legacyName), attachmentsDir);
  }
}

// Renames per-task private files: sessions.db -> task.db (with sidecars) and
// the legacy state file -> state.json.
function normalizeTaskPrivateFiles(taskFolder: string) {
  const privateDir = path.join(taskFolder, TASK_PRIVATE_FOLDER_NAME);
  if (!fs.existsSync(privateDir)) {
    return;
  }

  for (const suffix of DB_FILE_SUFFIXES) {
    moveIfMissingTarget(
      path.join(privateDir, LEGACY_DB_FILE_NAME + suffix),
      path.join(privateDir, TASK_DB_FILE_NAME + suffix),
    );
  }

  moveIfMissingTarget(
    path.join(privateDir, LEGACY_STATE_FILE_NAME),
    path.join(privateDir, TASK_STATE_FILE_NAME),
  );
}

// Normalizes every task folder to the current layout. Each step is idempotent
// and no-ops on a task already in the current shape.
function normalizeTasks(tasksDir: string) {
  if (!fs.existsSync(tasksDir)) {
    return;
  }
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskFolder = path.join(tasksDir, entry.name);
    normalizeTaskPrivateFiles(taskFolder);
    normalizeTaskSettingsFile(taskFolder);
    normalizeTaskWorkLayout(taskFolder);
    normalizeTaskAttachments(taskFolder);
  }
}

// Moves the settings file from the task root into the private dir, whether it
// is named `instrument.json` or `settings.json`.
function normalizeTaskSettingsFile(taskFolder: string) {
  const privateDir = path.join(taskFolder, TASK_PRIVATE_FOLDER_NAME);
  const settingsDestination = path.join(privateDir, TASK_SETTINGS_FILE_NAME);
  for (const filename of [TASK_SETTINGS_FILE_NAME, LEGACY_SETTINGS_FILE_NAME]) {
    moveIfMissingTarget(path.join(taskFolder, filename), settingsDestination);
  }
}

// Moves the runnable package and agent working dirs from the task root into
// work/. No-ops for tasks already in the current layout (no such root entries).
function normalizeTaskWorkLayout(taskFolder: string) {
  const workDir = path.join(taskFolder, TASK_FOLDER_NAMES.work);
  for (const name of WORK_ENTRY_NAMES) {
    moveIfMissingTarget(path.join(taskFolder, name), path.join(workDir, name));
  }
}
