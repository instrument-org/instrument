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

// Sentinel dropped in the workspace root's .instrument/ once the legacy
// projects/ -> tasks/ move has run. projects/ is now the live home of the
// projects feature, so that pass must run at most once -- its existence means
// "done", and a missing file means "not yet". Empty-by-design; only presence
// matters.
const LEGACY_PROJECTS_MIGRATED_MARKER_NAME = ".legacy-projects-migrated";

export interface WorkspaceLayoutMigration {
  // Task folder ids left in place because a task with the same id already
  // existed under tasks/ (never clobbered).
  conflictedTaskIds: string[];
  movedTaskCount: number;
}

// Boot migration to the current task layout
// (tasks/<id>/{.instrument/{task.db,settings.json},work/,attachments/,output/}).
//
// Two independent passes:
//   1. Move a legacy projects/ dir (the old name for tasks/) into tasks/.
//      projects/ is now the live home of the projects feature, and this move is
//      blind (it relocates whatever folders it finds), so it is protected two
//      ways that fail independently: a sentinel marker runs it at most once
//      (normally on first boot, before any project exists), and a per-folder
//      content guard (isProjectFolder) skips any real project even if the pass
//      ever runs against a populated projects/. The guard is the load-bearing
//      one -- it survives a lost/changed marker; the marker is the optimization.
//   2. Normalize every task already under tasks/ to the current layout. Keyed
//      purely on per-task legacy shapes (collision-free with the projects
//      feature), so it stays idempotent and re-runs every boot.
//
// Synchronous and rename-only: it runs at boot before the workspace serves
// tasks, while no db handle is open.
export function migrateWorkspaceLayout({
  rootDir,
}: {
  rootDir: string;
}): WorkspaceLayoutMigration {
  let migration: WorkspaceLayoutMigration = {
    conflictedTaskIds: [],
    movedTaskCount: 0,
  };
  if (!legacyProjectsMigrationDone(rootDir)) {
    migration = migrateLegacyProjectsDir(rootDir);
    markLegacyProjectsMigrationDone(rootDir);
  }

  normalizeTasks(path.join(rootDir, TASKS_DIR_NAME));
  return migration;
}

// True when a projects/ entry is a real projects-feature folder -- its
// .instrument/settings.json carries a ProjectId -- rather than a legacy task. A
// ProjectId (prj_<ULID>) is structurally distinct from a TaskId, so this never
// misclassifies a legacy task as a project. This is what keeps the (otherwise
// content-blind) move from ever relocating real project data.
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

    // A real projects-feature folder, not a legacy task: identified positively
    // by a ProjectId in its settings and left exactly where it is. This is the
    // primary safeguard -- it holds even if the run-once marker is missing,
    // renamed, or never written.
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

  // Drop the legacy dir once every task folder has moved. A preserved project
  // folder (or a stray .DS_Store) keeps it around -- correct, since projects/ is
  // the live home of the projects feature.
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
