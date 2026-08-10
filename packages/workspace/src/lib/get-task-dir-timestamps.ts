import fs from "node:fs/promises";

import { type TaskDir } from "../schemas/paths";
import { getCurrentDate } from "./get-current-date";
import { sessionStorePath } from "./task-dir-utils";

export async function getTaskDirTimestamps(dir: TaskDir) {
  const paths = [
    sessionStorePath(dir), // Changes when sessions/messages change.
    // Fallback for a task with no db yet. The task's own directory, not the
    // private one beside the db: adding a file to a directory bumps its mtime,
    // and the private directory holds the pane and the draft, so a task with no
    // conversation would climb the list every time someone opened a panel in it.
    dir,
  ];

  for (const path of paths) {
    try {
      // Stat directly and let a missing path throw, rather than a separate
      // access() existence probe -- that doubled the syscalls per task.
      const stats = await fs.stat(path);
      return {
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    } catch {
      continue;
    }
  }

  const now = getCurrentDate();
  // If all paths are missing, sort to the top
  return {
    createdAt: now,
    updatedAt: now,
  };
}
