import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import {
  CHAT_DB_FILE_NAME,
  CHAT_FOLDER_NAMES,
  HANDOFF_NOTES_FILE_NAME,
  TASKS_DIR_NAME,
} from "../constants";
import {
  entryExists,
  isDirectorySync,
  mergeEntrySync,
  moveEntrySync,
  removeIfEmptySync,
} from "./move-entry";
import { recordMovedPaths } from "./moved-paths";
import { workspaceLayout } from "./workspace-layout";

// The names earlier builds used, spelled out rather than built from the
// current ones: they are what is on disk from before.
const AGENT_BROWSER_HOME_DIR_NAME = "agent-browser-home";
const LEGACY_HANDOFF_NOTES_PATH = ["work", "handoff-notes.md"];
const TASK_RECORDS_SET_ASIDE_DIR_NAME = "chat-task-records";

// A SQLite database and the files beside it, sidecars first: a move cut short
// between them leaves the database where it was, with no sidecar the store
// would pair with a database that is not its own.
const DB_FILE_SUFFIXES = ["-wal", "-shm", "-journal", ""];

/**
 * What a work folder never takes from the folder it moves out of: what holds
 * this computer's absolute paths (a virtualenv's scripts and launchers,
 * pnpm's links) or only scratch, all of which the agent's next command makes
 * again where it now works.
 */
const REBUILT_ENTRY_NAMES = new Set(["node_modules", ".venv", ".tmp"]);

/** What a chat's record folder keeps; everything else in it is work. */
const RECORD_ENTRY_NAMES = new Set([
  CHAT_FOLDER_NAMES.attachments,
  HANDOFF_NOTES_FILE_NAME,
  SETTINGS_FILE_NAME,
  ...DB_FILE_SUFFIXES.map((suffix) => `${CHAT_DB_FILE_NAME}${suffix}`),
]);

export interface ChatRecordsSplit {
  /** One line per chat that changed, and one per entry left or failed. */
  done: string[];
  /** Entries that could not be moved, which the next sweep tries again. */
  failed: number;
}

/**
 * Takes each chat's work out of the folder that holds its records, as builds
 * before kept them together: the records (`chat.db`, `settings.json`) up out
 * of the folder's `.instrument/` to its top, beside `attachments/`, and the
 * handoff notes from `work/` beside them; everything else (`work/`,
 * `downloads/`, `.tool-output/`, the agent's own files, the package template)
 * into the chat's work folder in the workspace's machine folder, at the same
 * place below it, so a path stored relative to the old folder reads the same
 * file. The window's record folder is split the same way.
 *
 * A virtualenv, `node_modules` and the scratch folder are dropped rather than
 * moved, and so is `agent-browser`'s old home. A `tasks/` folder an earlier
 * build left in a chat goes to the work folder with the rest, but for each
 * old task's own records, which are set aside with what the migrations kept
 * (`setAsideDir`).
 *
 * Each entry is renamed (copied, then removed, across volumes, and retried
 * for a moment on Windows) only where its new place is free; a folder whose
 * new place is taken has its entries moved into it one by one, and an entry
 * still taken is left where it was. Settings move only after the database,
 * so a chat whose database could not move stays listed nowhere rather than
 * opening an empty one. Anything that fails is left in place for the next
 * sweep. Records where the work went (`recordMovedPaths`), so a path stored
 * before is found where it went. Synchronous, with no store open.
 */
export function splitChatRecords({
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): ChatRecordsSplit {
  const split: ChatRecordsSplit = { done: [], failed: 0 };
  const layout = workspaceLayout(rootDir);
  const { chatsDir } = layout;
  const workFoldersDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.work);
  const windowRecordDir = layout.windowDir;
  const windowWorkDir = path.join(workFoldersDir, "window");

  recordMovedPaths(machineDir, [
    { from: chatsDir, to: workFoldersDir },
    { from: windowRecordDir, to: windowWorkDir },
  ]);

  const folders = [
    ...readDirs(chatsDir)
      // A name with a dot is a chat the 1.x migration has not finished.
      .filter((name) => !name.startsWith("."))
      .map((name) => ({
        name,
        recordDir: path.join(chatsDir, name),
        workDir: path.join(workFoldersDir, name),
      })),
    ...(isDirectorySync(windowRecordDir)
      ? [
          {
            name: "window",
            recordDir: windowRecordDir,
            workDir: windowWorkDir,
          },
        ]
      : []),
  ];
  for (const folder of folders) {
    splitOne({
      ...folder,
      setAsideDir: path.join(
        layout.setAsideDir,
        TASK_RECORDS_SET_ASIDE_DIR_NAME,
        folder.name,
      ),
      split,
    });
  }
  return split;
}

function readEntries(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Runs one step of a chat's split, counting it as failed and logging why
 * when it throws, so the rest of the chat goes on.
 */
function step(split: ChatRecordsSplit, what: string, run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    split.failed++;
    split.done.push(`could not ${what} (${String(error)}); left it there`);
    return false;
  }
}

function splitOne({
  name,
  recordDir,
  setAsideDir,
  split,
  workDir,
}: {
  name: string;
  recordDir: string;
  setAsideDir: string;
  split: ChatRecordsSplit;
  workDir: string;
}) {
  const moved: string[] = [];
  const privateDir = path.join(recordDir, PRIVATE_FOLDER_NAME);

  // The records, up out of the private dir.
  let databaseMoved = true;
  for (const suffix of DB_FILE_SUFFIXES) {
    const file = `${CHAT_DB_FILE_NAME}${suffix}`;
    const from = path.join(privateDir, file);
    const to = path.join(recordDir, file);
    if (!entryExists(from)) {
      continue;
    }
    if (entryExists(to)) {
      split.done.push(`left ${from}: ${to} is already there`);
      databaseMoved = false;
      continue;
    }
    databaseMoved =
      step(split, `move ${from}`, () => {
        moveEntrySync(from, to);
        moved.push(`.instrument/${file}`);
      }) && databaseMoved;
  }
  const settings = path.join(privateDir, SETTINGS_FILE_NAME);
  if (databaseMoved && entryExists(settings)) {
    const to = path.join(recordDir, SETTINGS_FILE_NAME);
    if (entryExists(to)) {
      split.done.push(`left ${settings}: ${to} is already there`);
    } else {
      step(split, `move ${settings}`, () => {
        moveEntrySync(settings, to);
        moved.push(`.instrument/${SETTINGS_FILE_NAME}`);
      });
    }
  }
  const agentBrowserHome = path.join(privateDir, AGENT_BROWSER_HOME_DIR_NAME);
  if (entryExists(agentBrowserHome)) {
    step(split, `remove ${agentBrowserHome}`, () => {
      fs.rmSync(agentBrowserHome, { force: true, recursive: true });
    });
  }
  removeIfEmptySync(privateDir);
  if (entryExists(privateDir)) {
    split.done.push(
      `left ${privateDir} holding ${readEntries(privateDir).join(", ")}`,
    );
  }

  // The handoff notes are the conversation's, so they stay with its records.
  const notes = path.join(recordDir, ...LEGACY_HANDOFF_NOTES_PATH);
  const notesTo = path.join(recordDir, HANDOFF_NOTES_FILE_NAME);
  if (entryExists(notes) && !entryExists(notesTo)) {
    step(split, `move ${notes}`, () => {
      moveEntrySync(notes, notesTo);
      moved.push(LEGACY_HANDOFF_NOTES_PATH.join("/"));
    });
  }

  // An earlier build's task folders keep their files, which go with the
  // chat's work, but not their records or what rebuilds.
  const tasksDir = path.join(recordDir, TASKS_DIR_NAME);
  for (const task of readDirs(tasksDir)) {
    const taskDir = path.join(tasksDir, task);
    const taskRecords = path.join(taskDir, PRIVATE_FOLDER_NAME);
    if (entryExists(taskRecords)) {
      const to = path.join(setAsideDir, task);
      if (entryExists(to)) {
        split.done.push(`left ${taskRecords}: ${to} is already there`);
      } else {
        step(split, `set aside ${taskRecords}`, () => {
          moveEntrySync(taskRecords, to);
          moved.push(`tasks/${task}/.instrument (set aside)`);
        });
      }
    }
    for (const rebuilt of REBUILT_ENTRY_NAMES) {
      const entry = path.join(taskDir, rebuilt);
      if (entryExists(entry)) {
        step(split, `remove ${entry}`, () => {
          fs.rmSync(entry, { force: true, maxRetries: 3, recursive: true });
        });
      }
    }
    removeIfEmptySync(taskDir);
  }
  removeIfEmptySync(tasksDir);

  for (const entry of readEntries(recordDir)) {
    if (RECORD_ENTRY_NAMES.has(entry) || entry === PRIVATE_FOLDER_NAME) {
      continue;
    }
    const from = path.join(recordDir, entry);
    if (REBUILT_ENTRY_NAMES.has(entry)) {
      step(split, `remove ${from}`, () => {
        fs.rmSync(from, { force: true, maxRetries: 3, recursive: true });
        moved.push(`${entry} (removed)`);
      });
      continue;
    }
    step(split, `move ${from}`, () => {
      if (
        mergeEntrySync(from, path.join(workDir, entry), (left, taken) => {
          split.done.push(`left ${left}: ${taken} is already there`);
        })
      ) {
        moved.push(entry);
      }
    });
  }

  if (moved.length > 0) {
    split.done.push(
      `${name}: ${moved.join(", ")}, with its work in ${workDir}`,
    );
  }
}
