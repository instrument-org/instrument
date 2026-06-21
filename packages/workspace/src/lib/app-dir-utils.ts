import fs from "node:fs/promises";
import path from "node:path";

import {
  APP_FOLDER_NAMES,
  SESSIONS_DB_FILE_NAME,
} from "../constants";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import {
  type TaskId,
} from "../schemas/task-id";
import {
  type WorkspaceConfig,
} from "../types";
import {
  absolutePathJoin,
} from "./absolute-path-join";
import {
  getWorkspaceConfig,
} from "./workspace-config";

export function getAgentBrowserStateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(
    getStateDir(dir),
    APP_FOLDER_NAMES.agentBrowserState,
  );
}

export function getBrowserSessionDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(
    getTaskPrivateDir(dir),
    APP_FOLDER_NAMES.browserSession,
  );
}

export function getTaskPrivateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, APP_FOLDER_NAMES.private);
}

export function isRunnable(dir: TaskDir): Promise<boolean> {
  return fs
    .access(path.join(dir, "package.json"))
    .then(() => true)
    .catch(() => false);
}

export function registryAppExists({
  folderName,
  workspaceConfig,
}: {
  folderName: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<boolean> {
  const dir = absolutePathJoin(workspaceConfig.templatesDir, folderName);
  return fs
    .access(dir)
    .then(() => true)
    .catch(() => false);
}

export function sessionStorePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), SESSIONS_DB_FILE_NAME);
}

// The on-disk directory for a task. The id doubles as the folder name, so this
// is a pure path derivation off the workspace singleton — no carrier object.
export function taskDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id));
}

export function templateExists({
  folderName,
  workspaceConfig,
}: {
  folderName: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<boolean> {
  const templateDir = absolutePathJoin(
    workspaceConfig.templatesDir,
    folderName,
  );
  return fs
    .access(templateDir)
    .then(() => true)
    .catch(() => false);
}

function getStateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, APP_FOLDER_NAMES.state);
}
