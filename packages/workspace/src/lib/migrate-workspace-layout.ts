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
import { ProjectIdSchema } from "../schemas/project-id";
import { foldTaskStateFile } from "./fold-task-state-file";

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

// Presence = legacy projects/ already drained. Empty-by-design; only existence matters.
const LEGACY_PROJECTS_MIGRATED_MARKER_NAME = ".legacy-projects-migrated";

// Cloned Chrome profiles left in a task's temp dir from when agent-browser
// inherited it as TMPDIR. Each is a copy of the user's real profile -- cookies,
// login data, browsing history -- and inside the task it is indexed, packed
// into an export zip, and readable by the agent, so these are deleted rather
// than moved. Current builds clone outside the task entirely
// (getExternalBrowserTmpDir); a task restored from an old export can still
// carry one, so this keeps running.
const BROWSER_PROFILE_CLONE_PREFIX = "agent-browser-profile-";

export interface WorkspaceLayoutMigration {
  // Task folder ids left in place because a task with the same id already
  // existed under tasks/ (never clobbered).
  conflictedTaskIds: string[];
  movedTaskCount: number;
  // Chrome profile clones deleted, each a recursive delete of a few hundred MB
  // on the thread that owns the window. Reported so a boot that stalls on one
  // says so rather than looking like a hang.
  removedBrowserProfileCloneCount: number;
}

// Boot migration: two passes.
// 1. Move legacy projects/ (old name for tasks/) into tasks/. Guard: sentinel
//    runs the pass at most once; isProjectFolder skips any real project folder
//    (load-bearing — survives a lost marker).
// 2. Normalize tasks under tasks/ to current layout. Idempotent; runs every boot.
// Synchronous, and renames rather than copies except for the browser-profile
// clones it deletes outright; no db handle open.
export function migrateWorkspaceLayout({
  rootDir,
}: {
  rootDir: string;
}): WorkspaceLayoutMigration {
  let migration: WorkspaceLayoutMigration = {
    conflictedTaskIds: [],
    movedTaskCount: 0,
    removedBrowserProfileCloneCount: 0,
  };
  if (!legacyProjectsMigrationDone(rootDir)) {
    migration = migrateLegacyProjectsDir(rootDir);
    markLegacyProjectsMigrationDone(rootDir);
  }

  return {
    ...migration,
    removedBrowserProfileCloneCount: normalizeTasks(
      path.join(rootDir, TASKS_DIR_NAME),
    ),
  };
}

// A real project has a ProjectId (prj_<ULID>) in its settings; structurally
// distinct from a TaskId, so legacy tasks are never misclassified.
function isProjectFolder(folderPath: string): boolean {
  const settingsPath = path.join(
    folderPath,
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
    return false;
  }
  return ProjectIdSchema.safeParse(parsed.id).success;
}

function legacyProjectsMarkerPath(rootDir: string): string {
  return path.join(
    rootDir,
    TASK_PRIVATE_FOLDER_NAME,
    LEGACY_PROJECTS_MIGRATED_MARKER_NAME,
  );
}

function legacyProjectsMigrationDone(rootDir: string): boolean {
  return fs.existsSync(legacyProjectsMarkerPath(rootDir));
}

function markLegacyProjectsMigrationDone(rootDir: string) {
  const marker = legacyProjectsMarkerPath(rootDir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "");
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
    movedTaskCount: 0,
    removedBrowserProfileCloneCount: 0,
  };

  if (!fs.existsSync(legacyDir)) {
    return migration;
  }

  const tasksDir = path.join(rootDir, TASKS_DIR_NAME);
  fs.mkdirSync(tasksDir, { recursive: true });

  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const source = path.join(legacyDir, entry.name);

    if (isProjectFolder(source)) {
      continue;
    }

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

  // Drop legacy dir once empty. A project folder or .DS_Store keeps it around.
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
    return 0;
  }
  let removedBrowserProfileCloneCount = 0;
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskFolder = path.join(tasksDir, entry.name);
    normalizeTaskPrivateFiles(taskFolder);
    normalizeTaskSettingsFile(taskFolder);
    // After both, so `state.json` is under its current name and the settings
    // file it folds into is in the private dir.
    foldTaskStateFile(taskFolder);
    // After the fold, so the stamp is written to the file that survives it.
    stampTaskTimestamps(taskFolder);
    normalizeTaskWorkLayout(taskFolder);
    normalizeTaskAttachments(taskFolder);
    // After the work/ move, so a pre-work-layout task's clones are found at
    // their current path rather than the root one they were written to.
    removedBrowserProfileCloneCount += removeBrowserProfileClones(taskFolder);
  }
  return removedBrowserProfileCloneCount;
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

// What the list saw before the stamps existed: the session database's
// timestamps, falling back to the task folder's for a task that never opened
// one.
function observedTaskTimestamps(taskFolder: string) {
  const targets = [
    path.join(taskFolder, TASK_PRIVATE_FOLDER_NAME, TASK_DB_FILE_NAME),
    taskFolder,
  ];

  for (const target of targets) {
    try {
      const stats = fs.statSync(target);
      return {
        createdAt: stats.birthtime.toISOString(),
        lastActivityAt: stats.mtime.toISOString(),
      };
    } catch {
      continue;
    }
  }

  return;
}

// Deletes any cloned Chrome profile sitting in the task's temp dir. See
// BROWSER_PROFILE_CLONE_PREFIX.
function removeBrowserProfileClones(taskFolder: string) {
  const tmpDir = path.join(
    taskFolder,
    TASK_FOLDER_NAMES.work,
    TASK_FOLDER_NAMES.tmp,
  );
  if (!fs.existsSync(tmpDir)) {
    return 0;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith(BROWSER_PROFILE_CLONE_PREFIX)
    ) {
      fs.rmSync(path.join(tmpDir, entry.name), {
        force: true,
        recursive: true,
      });
      removed += 1;
    }
  }
  return removed;
}

/**
 * Records a task's timestamps in its settings, for one made before they were
 * written there.
 *
 * Seeded from the session database, which is exactly where the list read them
 * from before, so a workspace's order survives the move to recorded stamps and
 * nobody's list rearranges itself on the upgrade. That inherits the flaw it is
 * replacing -- a task merely opened last week is stamped last week -- but that
 * is what its owner already sees, and the mtime stops drifting from here.
 *
 * Stamping the current time instead would flatten every task in the workspace
 * to one value and scramble the list, which is the failure worth naming.
 */
function stampTaskTimestamps(taskFolder: string) {
  const settingsPath = path.join(
    taskFolder,
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // No settings, or none this can read. Nothing to preserve, and the task
    // folder still answers for it when the list asks.
    return;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return;
  }

  const settings: Record<string, unknown> = { ...parsed };

  // A project folder that ended up under tasks/ carries its own createdAt and
  // has no activity to record.
  if (ProjectIdSchema.safeParse(settings.id).success) {
    return;
  }

  if (
    settings.createdAt !== undefined &&
    settings.lastActivityAt !== undefined
  ) {
    return;
  }

  const observed = observedTaskTimestamps(taskFolder);
  if (!observed) {
    return;
  }

  settings.createdAt ??= observed.createdAt;
  settings.lastActivityAt ??= observed.lastActivityAt;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
