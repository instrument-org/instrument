import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CHAT_DB_FILE_NAME,
  LEGACY_TASK_DB_FILE_NAME,
  CHAT_FOLDER_NAMES,
  TASK_STATE_FILE_NAME,
  TASKS_DIR_NAME,
} from "../constants";
import { ProjectIdSchema } from "../schemas/project-id";
import { foldTaskStateFile } from "./fold-task-state-file";
import { foldTaskWorkDir } from "./fold-task-work-dir";
import {
  type LegacyTasksMigration,
  migrateLegacyTasks,
} from "./migrate-legacy-tasks";
import { readJsonRecordSync, updateJsonRecordSync } from "./json-record-file";
import {
  type AppFoldersMove,
  moveAppFoldersIntoDataDir,
} from "./move-app-folders";
import {
  entryExists,
  isDirectorySync,
  moveEntrySync,
  removeIfEmptySync,
} from "./move-entry";
import { recordMovedPaths } from "./moved-paths";
import { type ChatRecordsSplit, splitChatRecords } from "./split-chat-records";
import { STORE_TABLE } from "./store-table";
import { workspaceLayout } from "./workspace-layout";

// Legacy on-disk names this migration renames to their current equivalents.
const LEGACY_TASKS_DIR_NAME = "projects";
const LEGACY_DB_FILE_NAME = "sessions.db";
const LEGACY_STATE_FILE_NAME = "project-state.json";
const LEGACY_SETTINGS_FILE_NAME = "instrument.json";
const LEGACY_ATTACHMENT_DIR_NAMES = ["user-provided", "agent-retrieved"];

// Where the empty `chat.db` a chat held while its own sessions were still in
// the `task.db` beside it is kept, with what the migrations set aside rather
// than delete.
const EMPTY_STORES_SET_ASIDE_DIR_NAME = "empty-chat-stores";

// `.state` is intentionally not migrated: the task db stores direct path
// references to screenshots/bash-output under `.state/`, so moving the files
// would orphan them. It stays in place, still ignored by the file index.

// SQLite keeps sidecar files next to the db; they must travel with it. Empty
// suffix is the db file itself. Harmless if a given sidecar is absent.
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

// The layoutVersion mark holding this value = a sweep at this version has
// visited every task under tasks/ and made every 1.x task into a chat and
// every project into a topic, so boot skips both walks (their cost grows with
// the task count, and they are a no-op for every task a current build
// touched). Bump the version when a normalization step is added, so existing
// workspaces run the sweep once more. Between bumps, tasks must enter the
// workspace only through code that leaves them in the current shape, as
// initializeTask does. A task folder hand-copied into tasks/, or one a 1.x
// build writes after the sweep, stays as it is until the next version bump.
// 5: each chat's work moved out of the folder holding its records
// (splitChatRecords).
// 6: the app's folders moved from the workspace's top level into its
// `.instrument/` (moveAppFoldersIntoDataDir).
// 7: a chat whose `chat.db` holds no sessions given the `task.db` beside it
// that holds its conversation (renameChatDatabases).
export const WORKSPACE_LAYOUT_VERSION = 7;

// The temp folder an external browser cloned the person's Chrome profile
// into, in the workspace's `.instrument/`, which nothing writes since that
// browser was removed. Spelled out: it is a name from builds before.
const EXTERNAL_BROWSER_TMP_DIR_NAME = "external-browser-tmp";

// Cloned Chrome profiles left in a task's temp dir from when agent-browser
// inherited it as TMPDIR. Each is a copy of the user's real profile -- cookies,
// login data, browsing history -- and inside the task it is indexed and
// readable by the agent, so these are deleted rather than moved. No build
// clones one now; a task written by an older build can still carry one.
const BROWSER_PROFILE_CLONE_PREFIX = "agent-browser-profile-";

/** How far this migration has brought a workspace. */
export interface LayoutMarks {
  /** The layout version the last sweep that finished with nothing left over ran at. */
  layoutVersion?: number;
  /** Set once legacy `projects/` has been drained into `tasks/`. */
  legacyProjectsMigrated?: boolean;
}

/**
 * Where the marks are kept, by whoever owns the workspace's own record (the
 * app keeps them in its `workspace.json`). A write names only what changed.
 */
export interface LayoutMarkStore {
  read(): LayoutMarks;
  write(change: LayoutMarks): void;
}

export interface WorkspaceLayoutMigration {
  // What moving the app's folders into the workspace's `.instrument/`, and
  // setting aside what 1.x left in `projects/`, did, for the boot log.
  appFolders: AppFoldersMove;
  // What naming each chat's database and splitting its records from its work
  // did, for the boot log.
  chatRecords: ChatRecordsSplit;
  // Task folder ids left in place because a task with the same id already
  // existed under tasks/ (never clobbered).
  conflictedTaskIds: string[];
  // Tasks an earlier version ran on their own, each made into a chat that
  // owns it, and projects made into topics.
  legacyTasks: LegacyTasksMigration;
  movedTaskCount: number;
  // Chrome profile clones deleted, each a recursive delete of a few hundred MB
  // on the chat that owns the window. Reported so a boot that stalls on one
  // says so rather than looking like a hang.
  removedBrowserProfileCloneCount: number;
}

// Boot migration: two passes.
// 1. Move legacy projects/ (old name for tasks/) into tasks/. Guard: the
//    legacyProjectsMigrated mark runs the pass at most once; isProjectFolder
//    skips any real project folder (load-bearing: it survives a lost mark).
// 2. Move the app's folders into the workspace's `.instrument/`, normalize
//    tasks under tasks/ to current layout, then make 1.x tasks into chats and
//    projects into topics, then split every chat's records from its work,
//    which the 1.x tasks just made into chats need as much as the chats an
//    earlier build made. The folders move first, so the steps after it
//    (and a later sweep finishing what one left) find every chat and topic
//    where it now lives. Idempotent. Guard: the layoutVersion
//    mark skips it once a sweep at the current version has completed, and
//    is written only after one completes with nothing left over, so a sweep a
//    crash cut short retries on the next boot. It also runs whenever pass 1
//    did, since the tasks that pass moves in are legacy-shaped.
// Synchronous, and renames rather than copies except for the browser-profile
// clones it deletes outright; no db handle open.
export function migrateWorkspaceLayout({
  machineDir,
  marks,
  rootDir,
}: {
  /** This computer's folder for the workspace, where each chat's work goes. */
  machineDir: string;
  marks: LayoutMarkStore;
  rootDir: string;
}): WorkspaceLayoutMigration {
  let migration: Omit<
    WorkspaceLayoutMigration,
    "appFolders" | "chatRecords" | "legacyTasks"
  > = {
    conflictedTaskIds: [],
    movedTaskCount: 0,
    removedBrowserProfileCloneCount: 0,
  };
  const { layoutVersion, legacyProjectsMigrated } = marks.read();
  const legacyMigrationRan = legacyProjectsMigrated !== true;
  if (legacyMigrationRan) {
    migration = migrateLegacyProjectsDir(rootDir);
    marks.write({ legacyProjectsMigrated: true });
  }

  if (!legacyMigrationRan && layoutVersion === WORKSPACE_LAYOUT_VERSION) {
    return {
      ...migration,
      appFolders: { done: [], failed: 0 },
      chatRecords: { done: [], failed: 0 },
      legacyTasks: {
        adoptedCount: 0,
        emptyCount: 0,
        leftOver: 0,
        topicCount: 0,
      },
    };
  }

  const movedIn = moveAppFoldersIntoDataDir({ machineDir, rootDir });
  const named = renameChatDatabases(rootDir);
  const removedBrowserProfileCloneCount = normalizeTasks(
    path.join(rootDir, TASKS_DIR_NAME),
  );
  // After the task sweep, so each task an earlier version ran is in its
  // current shape when it is made into a chat.
  const legacyTasks = migrateLegacyTasks(rootDir);
  // After the 1.x migration, which turns the projects in `projects/` into
  // topics first.
  const projectsLeft = setAsideLegacyProjectsDir({ machineDir, rootDir });
  const appFolders = {
    done: [...movedIn.done, ...projectsLeft.done],
    failed: movedIn.failed + projectsLeft.failed,
  };
  // 1.x kept its tasks there, and nothing else is: once they are chats, the
  // folder goes.
  removeIfEmptySync(path.join(rootDir, TASKS_DIR_NAME));
  // After the 1.x migration, whose chats it splits too.
  const split = splitChatRecords({ machineDir, rootDir });
  const chatRecords: ChatRecordsSplit = {
    done: [...named.done, ...split.done],
    failed: named.failed + split.failed,
  };
  fs.rmSync(
    path.join(workspaceLayout(rootDir).dataDir, EXTERNAL_BROWSER_TMP_DIR_NAME),
    {
      force: true,
      recursive: true,
    },
  );
  // A task or project left over, a chat left staged with its task inside, or
  // an entry a move or a split could not move, is finished by the next
  // boot's sweep.
  if (
    appFolders.failed === 0 &&
    legacyTasks.leftOver === 0 &&
    chatRecords.failed === 0
  ) {
    marks.write({ layoutVersion: WORKSPACE_LAYOUT_VERSION });
  }

  return {
    ...migration,
    appFolders,
    chatRecords,
    legacyTasks,
    removedBrowserProfileCloneCount,
  };
}

// A real project has a ProjectId (prj_<ULID>) in its settings; structurally
// distinct from a ChatId, so legacy tasks are never misclassified.
function isProjectFolder(folderPath: string): boolean {
  const settingsPath = path.join(
    folderPath,
    PRIVATE_FOLDER_NAME,
    SETTINGS_FILE_NAME,
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

function migrateLegacyProjectsDir(
  rootDir: string,
): Omit<
  WorkspaceLayoutMigration,
  "appFolders" | "chatRecords" | "legacyTasks"
> {
  const legacyDir = path.join(rootDir, LEGACY_TASKS_DIR_NAME);
  const migration: Omit<
    WorkspaceLayoutMigration,
    "appFolders" | "chatRecords" | "legacyTasks"
  > = {
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

/**
 * What 1.x left in the workspace's top-level `projects/` once its tasks
 * moved to `tasks/` and its projects became topics (a file beside them, a
 * task copy whose id another task had), set aside with the projects already
 * in `.instrument/.pre-chats/projects/`, and the folder removed once empty.
 * The top level becomes the person's folder, and the output folder once
 * the workspace moves, so it keeps none of 1.x's. An entry whose name is
 * taken there goes beside it under a numbered name; a project still waiting
 * for its topic stays for the 1.x migration, and a `projects` that is a
 * link or a file stays as it is. An entry that cannot move is counted in
 * `failed`, so the next sweep tries it again.
 */
function setAsideLegacyProjectsDir({
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): AppFoldersMove {
  const move: AppFoldersMove = { done: [], failed: 0 };
  const legacyDir = path.join(rootDir, LEGACY_TASKS_DIR_NAME);
  if (!isDirectorySync(legacyDir)) {
    return move;
  }
  const asideDir = path.join(
    workspaceLayout(rootDir).setAsideDir,
    LEGACY_TASKS_DIR_NAME,
  );
  const names = fs
    .readdirSync(legacyDir)
    .filter((name) => !isProjectFolder(path.join(legacyDir, name)));
  if (names.length > 0) {
    recordMovedPaths(machineDir, [{ from: legacyDir, to: asideDir }]);
  }
  for (const name of names) {
    const from = path.join(legacyDir, name);
    let to = path.join(asideDir, name);
    for (let suffix = 2; entryExists(to); suffix += 1) {
      to = path.join(asideDir, `${name}-${suffix.toString()}`);
    }
    try {
      moveEntrySync(from, to);
      move.done.push(`set aside ${from} in ${to}`);
    } catch (error) {
      move.failed++;
      move.done.push(
        `could not set aside ${from} (${String(error)}); left it there`,
      );
    }
  }
  removeIfEmptySync(legacyDir);
  return move;
}

function moveIfMissingTarget(source: string, destination: string) {
  if (fs.existsSync(source) && !fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
  }
}

// Normalizes one task folder to the current layout. Each step is idempotent
// and no-ops on a task already in the current shape. Called for every task by
// the mark-gated boot sweep. Returns the number of browser profile clones
// deleted.
function normalizeTask(taskFolder: string): number {
  normalizeTaskPrivateFiles(taskFolder);
  normalizeTaskSettingsFile(taskFolder);
  // After both, so `state.json` is under its current name and the settings
  // file it folds into is in the private dir.
  foldTaskStateFile(taskFolder);
  // After the fold, so the stamp is written to the file that survives it.
  stampTaskTimestamps(taskFolder);
  normalizeTaskAttachments(taskFolder);
  // Before the work/ fold, so a clone is found at the path the build that
  // wrote it used rather than the one the fold is about to move it to.
  const removedBrowserProfileCloneCount =
    removeBrowserProfileClones(taskFolder);
  foldTaskWorkDir(taskFolder);
  return removedBrowserProfileCloneCount;
}

// Folds legacy user-input dirs (user-provided/, agent-retrieved/) into a single
// attachments/ dir.
function normalizeTaskAttachments(taskFolder: string) {
  const attachmentsDir = path.join(taskFolder, CHAT_FOLDER_NAMES.attachments);
  for (const legacyName of LEGACY_ATTACHMENT_DIR_NAMES) {
    mergeDirInto(path.join(taskFolder, legacyName), attachmentsDir);
  }
}

// Renames a 1.x task's private files to the names the 1.x migration reads:
// sessions.db -> task.db (with sidecars) and the legacy state file ->
// state.json.
function normalizeTaskPrivateFiles(taskFolder: string) {
  const privateDir = path.join(taskFolder, PRIVATE_FOLDER_NAME);
  if (!fs.existsSync(privateDir)) {
    return;
  }

  for (const suffix of DB_FILE_SUFFIXES) {
    moveIfMissingTarget(
      path.join(privateDir, LEGACY_DB_FILE_NAME + suffix),
      path.join(privateDir, LEGACY_TASK_DB_FILE_NAME + suffix),
    );
  }

  moveIfMissingTarget(
    path.join(privateDir, LEGACY_STATE_FILE_NAME),
    path.join(privateDir, TASK_STATE_FILE_NAME),
  );
}

/**
 * Renames each chat's database from the name it had while a chat was a task
 * record (`task.db`) to `chat.db`, and the window's, which is scoped like a
 * chat. Only a chat's own record folder is touched: a folder an earlier build
 * left under a chat's `tasks/` stays as it is, and so does a chat the 1.x
 * migration staged and has not finished, whose database that migration names
 * itself.
 *
 * Runs for every workspace, a folder the person picked included, rather than
 * only with the rest of the sweep: which database a chat opens is what a chat
 * needs before it is read, and nothing else settles one left opening an empty
 * store. What it reads and renames is in the workspace's own `.instrument/`
 * alone, every path below a chat's record folder, the window's, or
 * `.pre-chats/`, so the person's own folders are never reached. A record
 * folder, a folder's own `.instrument/`, or `chats/` itself that is a link is
 * left as it is rather than followed out of there.
 */
export function renameChatDatabases(rootDir: string): ChatRecordsSplit {
  const named: ChatRecordsSplit = { done: [], failed: 0 };
  const layout = workspaceLayout(rootDir);
  const chats = isDirectorySync(layout.chatsDir)
    ? fs
        .readdirSync(layout.chatsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => path.join(layout.chatsDir, entry.name))
    : [];
  for (const folder of [...chats, layout.windowDir].filter((candidate) =>
    isDirectorySync(candidate),
  )) {
    const name = path.basename(folder);
    renameChatDatabase({
      asideDir: path.join(
        layout.setAsideDir,
        EMPTY_STORES_SET_ASIDE_DIR_NAME,
        name,
      ),
      name,
      named,
      recordDir: folder,
    });
  }
  return named;
}

/**
 * One folder's `task.db` as `chat.db`: its sidecars first and the database
 * last, so a sweep cut short between them leaves the rest for the next boot's
 * sweep rather than a database apart from its write-ahead log. It takes the
 * place of the store the chat opens, at the top of the record folder or in
 * the folder's own `.instrument/` for a chat no split has reached, and where
 * there is no store at all it lands in the `.instrument/`, which the split
 * that follows lifts to the top.
 *
 * A `chat.db` holding the chat's own sessions is never overwritten, wherever
 * the chat opens it.
 */
function renameChatDatabase({
  asideDir,
  name,
  named,
  recordDir,
}: {
  asideDir: string;
  /** The chat the folder is, which a line names it by. */
  name: string;
  named: ChatRecordsSplit;
  recordDir: string;
}) {
  const privateDir = path.join(recordDir, PRIVATE_FOLDER_NAME);
  if (!isDirectorySync(privateDir)) {
    return;
  }
  const legacy = path.join(privateDir, LEGACY_TASK_DB_FILE_NAME);
  if (!fs.existsSync(legacy)) {
    return;
  }
  const atTop = path.join(recordDir, CHAT_DB_FILE_NAME);
  const store = fs.existsSync(atTop)
    ? atTop
    : path.join(privateDir, CHAT_DB_FILE_NAME);
  if (
    fs.existsSync(store) &&
    !freeStoreName({ asideDir, legacy, name, named, store })
  ) {
    return;
  }
  for (const suffix of [...DB_FILE_SUFFIXES.filter(Boolean), ""]) {
    moveIfMissingTarget(
      path.join(privateDir, LEGACY_TASK_DB_FILE_NAME + suffix),
      `${store}${suffix}`,
    );
  }
}

/**
 * Takes the name `chat.db` back for the `task.db` beside it where the
 * `chat.db` there holds no sessions and the `task.db` does: a build that
 * opened the chat before a sweep reached it left an empty store under the
 * new name, and nothing outside this sweep reads `task.db`, so the chat
 * opens empty while its conversation sits in a file nothing reads. The empty
 * one is set aside in the workspace's own folder rather than deleted,
 * sidecars first and the database last, so a sweep cut short leaves no
 * database paired with a sidecar that is not its own. Answers whether the
 * name is free.
 *
 * Where both hold sessions, or either cannot be read, both files stay as
 * they are, the `task.db` under its own name, and a line says which held
 * what: choosing between two conversations is a person's to do, and no later
 * sweep settles it, so it is not counted as left over either. Every sweep
 * after leaves the same two files.
 */
function freeStoreName({
  asideDir,
  legacy,
  name,
  named,
  store,
}: {
  asideDir: string;
  legacy: string;
  name: string;
  named: ChatRecordsSplit;
  store: string;
}): boolean {
  const inStore = holdsSessions(store);
  const inLegacy = holdsSessions(legacy);
  if (inStore !== false || inLegacy !== true) {
    named.done.push(
      `${name}: left ${store} (${sessionsHeld(inStore)}) beside ${legacy} (${sessionsHeld(inLegacy)})`,
    );
    return false;
  }
  let aside = asideDir;
  for (let suffix = 2; entryExists(aside); suffix += 1) {
    aside = `${asideDir}-${suffix.toString()}`;
  }
  try {
    for (const suffix of [...DB_FILE_SUFFIXES.filter(Boolean), ""]) {
      const from = `${store}${suffix}`;
      if (fs.existsSync(from)) {
        moveEntrySync(from, path.join(aside, path.basename(from)));
      }
    }
  } catch (error) {
    named.failed++;
    named.done.push(
      `could not set aside ${store} (${String(error)}); left it there`,
    );
    return false;
  }
  named.done.push(
    `${name}: set aside ${store}, which held no sessions, in ${aside}, and took the ${LEGACY_TASK_DB_FILE_NAME} beside it`,
  );
  return true;
}

/**
 * Whether a store holds a session, or `undefined` where SQLite could not
 * read it, which is as good as holding one: nothing then moves. Read-only
 * and one statement over the key each session is filed under, with none of
 * the store's own migrations run on it, so a store this build has not opened
 * is left exactly as the build that wrote it left it.
 */
function holdsSessions(file: string): boolean | undefined {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    return (
      database
        .prepare(
          `select key from ${STORE_TABLE} where key like 'sessions:%' limit 1`,
        )
        .get() !== undefined
    );
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

/** What a line says a store held. */
function sessionsHeld(sessions: boolean | undefined): string {
  if (sessions === undefined) {
    return "could not be read";
  }
  return sessions ? "holds sessions" : "holds none";
}

// Normalizes every task folder to the current layout.
function normalizeTasks(tasksDir: string) {
  if (!fs.existsSync(tasksDir)) {
    return 0;
  }
  let removedBrowserProfileCloneCount = 0;
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    removedBrowserProfileCloneCount += normalizeTask(
      path.join(tasksDir, entry.name),
    );
  }
  return removedBrowserProfileCloneCount;
}

// Moves the settings file from the task root into the private dir, whether it
// is named `instrument.json` or `settings.json`.
function normalizeTaskSettingsFile(taskFolder: string) {
  const privateDir = path.join(taskFolder, PRIVATE_FOLDER_NAME);
  const settingsDestination = path.join(privateDir, SETTINGS_FILE_NAME);
  for (const filename of [SETTINGS_FILE_NAME, LEGACY_SETTINGS_FILE_NAME]) {
    moveIfMissingTarget(path.join(taskFolder, filename), settingsDestination);
  }
}

// What the list saw before the stamps existed: the session database's
// timestamps, falling back to the task folder's for a task that never opened
// one.
function observedTaskTimestamps(taskFolder: string) {
  const targets = [
    path.join(taskFolder, PRIVATE_FOLDER_NAME, LEGACY_TASK_DB_FILE_NAME),
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
// BROWSER_PROFILE_CLONE_PREFIX. The path is spelled out rather than built from
// the current folder names: a clone can only exist where the build that made
// one wrote it, and the temp dir has moved since.
function removeBrowserProfileClones(taskFolder: string) {
  const tmpDir = path.join(taskFolder, "work", "tmp");
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
    PRIVATE_FOLDER_NAME,
    SETTINGS_FILE_NAME,
  );

  const read = readJsonRecordSync(settingsPath);
  if (read.kind !== "read") {
    // No settings, or none this can read. Nothing to preserve, and the task
    // folder still answers for it when the list asks.
    return;
  }
  const settings = read.record;

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

  updateJsonRecordSync(settingsPath, (current) => ({
    createdAt: current.createdAt ?? observed.createdAt,
    lastActivityAt: current.lastActivityAt ?? observed.lastActivityAt,
  }));
}
