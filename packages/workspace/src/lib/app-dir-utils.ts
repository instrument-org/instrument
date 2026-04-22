import fs from "node:fs/promises";
import path from "node:path";

import { APP_FOLDER_NAMES, SESSIONS_DB_FILE_NAME } from "../constants";
import { type AbsolutePath, type AppDir } from "../schemas/paths";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";

export function getAgentBrowserStateDir(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(
    getStateDir(appDir),
    APP_FOLDER_NAMES.agentBrowserState,
  );
}

export function getAppPrivateDir(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(appDir, APP_FOLDER_NAMES.private);
}

export function getBrowserSessionDir(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(
    getAppPrivateDir(appDir),
    APP_FOLDER_NAMES.browserSession,
  );
}

export function getSandboxesDir(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(getAppPrivateDir(appDir), "sandboxes");
}

export function isRunnable(appDir: AppDir): Promise<boolean> {
  return fs
    .access(path.join(appDir, "package.json"))
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
  const appDir = absolutePathJoin(workspaceConfig.templatesDir, folderName);
  return fs
    .access(appDir)
    .then(() => true)
    .catch(() => false);
}

export function sessionStorePath(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(getAppPrivateDir(appDir), SESSIONS_DB_FILE_NAME);
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

function getStateDir(appDir: AppDir): AbsolutePath {
  return absolutePathJoin(appDir, APP_FOLDER_NAMES.state);
}
