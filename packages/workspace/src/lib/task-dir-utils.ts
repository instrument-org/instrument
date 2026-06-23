import fs from "node:fs/promises";
import path from "node:path";

import { STORE_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

export function getAgentBrowserStateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(
    getStateDir(dir),
    TASK_FOLDER_NAMES.agentBrowserState,
  );
}

export function getBrowserSessionDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(
    getTaskPrivateDir(dir),
    TASK_FOLDER_NAMES.browserSession,
  );
}

export function getTaskPrivateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.private);
}

export function isRunnable(dir: TaskDir): Promise<boolean> {
  return fs
    .access(path.join(dir, "package.json"))
    .then(() => true)
    .catch(() => false);
}

export function sessionStorePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), STORE_DB_FILE_NAME);
}

// The on-disk directory for a task. The id doubles as the folder name, so this
// is a pure path derivation off the workspace singleton — no carrier object.
export function taskDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id));
}

function getStateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.state);
}
