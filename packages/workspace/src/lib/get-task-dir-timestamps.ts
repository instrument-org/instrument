import fs from "node:fs/promises";

import { type TaskDir } from "../schemas/paths";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";
import { getTaskPrivateDir, sessionStorePath } from "./task-dir-utils";

export async function getTaskDirTimestamps(dir: TaskDir) {
  const paths = [
    sessionStorePath(dir), // Changes when sessions/messages change.
    getTaskPrivateDir(dir), // Fallback for tasks without a db yet.
  ];

  for (const path of paths) {
    try {
      if (await pathExists(path)) {
        const stats = await fs.stat(path);
        return {
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
        };
      }
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
