import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { TASK_STATE_FILE_NAME } from "../constants";

/**
 * Folds a task's separate `state.json` into its settings file and removes it.
 *
 * The two were one file's worth of data kept in two, and the reason they were
 * split did not survive scrutiny -- see the finding on the task list following
 * file timestamps. State becomes a nested key so the boundary between "what the
 * app asks about a task" and "where the user left off inside it" stays legible
 * without costing a second file.
 *
 * Synchronous and idempotent, so the boot pass can call it for every task and
 * an import can call it for one. A task already folded has no `state.json` and
 * returns immediately without reading anything.
 *
 * Deliberately conservative: anything it cannot read, it leaves alone. A task
 * that keeps both files is one this could not fold, not one it damaged, and it
 * gets another attempt on the next boot.
 */
export function foldTaskStateFile(taskFolder: string): boolean {
  const privateDir = path.join(taskFolder, TASK_PRIVATE_FOLDER_NAME);
  const statePath = path.join(privateDir, TASK_STATE_FILE_NAME);
  const settingsPath = path.join(privateDir, TASK_SETTINGS_FILE_NAME);

  let state: unknown;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    // No state file, which is the answer for every task after the first fold.
    return false;
  }

  if (!isRecord(state)) {
    return false;
  }

  let settings: unknown = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      // Settings that cannot be read would be replaced by this write, taking
      // the task's title with them. Leave both files for a person to look at.
      return false;
    }
  }

  if (!isRecord(settings)) {
    return false;
  }

  // An already-folded settings file wins: it is the newer of the two, and a
  // stale `state.json` left behind by a half-finished fold must not overwrite
  // what has been written since.
  const folded = { ...settings, state: settings.state ?? state };

  // Through a temporary file, for the reason writeTaskRecord does it: this runs
  // over every task at boot, which is the moment the app is least likely to be
  // shut down cleanly, and a truncated settings file does not read as damaged.
  // It reads as a task with no name and no place in the list, and the next
  // boot's fold correctly refuses to touch it, so it stays that way.
  //
  // A crash between the rename and the delete is already survivable: the state
  // file is still there, and the settings file has won by then, which is what
  // the check above is for.
  const temporary = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(folded, null, 2));
  fs.renameSync(temporary, settingsPath);
  fs.rmSync(statePath, { force: true });

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
