import fs from "node:fs/promises";

import { type TaskDir } from "../schemas/paths";
import { getCurrentDate } from "./get-current-date";

/**
 * The task folder's own timestamps, for a task with nothing recorded.
 *
 * The folder and not the session database inside it: opening a task checkpoints
 * that database, so its mtime says a task was worked on when it was only read.
 *
 * See docs/findings/task-list-order-followed-file-mtimes.md.
 */
export async function getTaskDirTimestamps(dir: TaskDir) {
  try {
    return await fs.stat(dir).then((stats) => ({
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
    }));
  } catch {
    // The folder was listed moments ago. Gone now means deleted mid-scan, so
    // answer rather than fail the whole list.
    const now = getCurrentDate();
    return { createdAt: now, updatedAt: now };
  }
}
