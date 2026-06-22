import { TASK_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";

import { type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getTaskPrivateDir } from "./app-dir-utils";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";

export async function getTaskDirTimestamps(dir: TaskDir) {
  const privateDir = getTaskPrivateDir(dir);
  const taskConfigPath = absolutePathJoin(dir, TASK_MANIFEST_FILE_NAME);
  const paths = [
    privateDir, // Changes when agent changes
    taskConfigPath, // Changes when app name/icon changes
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
