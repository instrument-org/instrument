import fs from "node:fs/promises";
import path from "node:path";

import { TASK_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

export function getBrowserSessionDir(): AbsolutePath {
  return absolutePathJoin(
    getWorkspaceConfig().rootDir,
    TASK_FOLDER_NAMES.private,
    TASK_FOLDER_NAMES.browserSession,
  );
}

// Files the agent downloads (e.g. via the browser). A user-visible top-level
// folder so the user can see them and the agent can reach them with a simple
// relative path.
export function getDownloadsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.downloads);
}

// Browser screenshots: app-managed byproducts surfaced to the user, kept in the
// private dir and included in task exports.
export function getScreenshotsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(
    getTaskPrivateDir(dir),
    TASK_FOLDER_NAMES.screenshots,
  );
}

// The user's inputs (uploads + copies from attached folders). A user-visible top-level dir.
export function getTaskAttachmentsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.attachments);
}

export function getTaskPrivateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.private);
}

// The runnable package and all agent working files live under work/.
export function getTaskWorkDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.work);
}

export function isRunnable(dir: TaskDir): Promise<boolean> {
  return fs
    .access(path.join(getTaskWorkDir(dir), "package.json"))
    .then(() => true)
    .catch(() => false);
}

export function sessionStorePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_DB_FILE_NAME);
}

// The on-disk directory for a task. The id doubles as the folder name, so this
// is a pure path derivation off the workspace singleton — no carrier object.
export function taskDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id));
}
