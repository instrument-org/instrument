import { app } from "electron";

import { settlePlatformApiServer } from "../platform-api/base-url";
import { getMachinePreferences } from "../stores/machine/preferences";
import { logger } from "./electron-logger";
import { getUserDataDir } from "./get-workspace-folder";
import { cleanUpMachineData } from "./machine-cleanups";
import { moveMachineData } from "./machine-data-migration";
import {
  migrateMachineSettings,
  migrateWorkspaceSettings,
} from "./settings-migration";
import { settleWorkFolders } from "./work-folders";
import { finishPendingMove } from "./workspace-move";
import {
  inspectWorkspaceFolder,
  type WorkspaceRefusal,
} from "./workspace-refusal";
import {
  getResolvedWorkspace,
  markWorkspaceOpen,
  releaseOpenMark,
  renameMachineFolder,
  resolveWorkspace,
  setResolvedWorkspace,
} from "./workspaces";

/**
 * Settles which workspace this process runs, makes a move to a folder the
 * person picked, brings its settings up to this build, and moves what is
 * this computer's own into its machine folder, before any of its stores
 * opens: every workspace store reads its folder from the resolved workspace
 * when it is first asked for. At launch it also settles what is the
 * process's (the machine's settings, the platform API's server); a workspace
 * opened later in the same process (`live-workspace-switch.ts`) runs only the
 * workspace's steps, once the one before it has closed.
 *
 * A folder made by a newer build, one that cannot be read, or one in a place
 * no workspace can be is not opened, and answers why.
 */
export function openWorkspace({
  atLaunch,
}: {
  atLaunch: boolean;
}): { kind: "open" } | { kind: "refused"; refusal: WorkspaceRefusal } {
  const userDataDir = getUserDataDir();
  // Before the workspace resolves, which takes a path inside this folder.
  for (const step of renameMachineFolder(userDataDir)) {
    logger.info(`Machine folder: ${step}`);
  }
  const resolved = resolveWorkspace({
    pin: process.env.INSTRUMENT_WORKSPACE,
    userDataDir,
  });
  for (const problem of resolved.problems) {
    logger.warn(problem);
  }
  const { done: moveSteps, workspace } = finishPendingMove({
    userDataDir,
    workspace: resolved.workspace,
  });
  for (const step of moveSteps) {
    logger.info(`Workspace move: ${step}`);
  }
  logger.info(
    `Workspace ${workspace.id}${workspace.pinned ? " (pinned)" : ""}: ${workspace.path}`,
  );
  const refusal = inspectWorkspaceFolder({ userDataDir, workspace });
  if (refusal) {
    logger.warn(
      refusal.kind === "newer"
        ? `Not opening ${workspace.path}: a newer build made it`
        : refusal.kind === "misplaced"
          ? `Not opening ${workspace.path}: no workspace can be there (${refusal.reason})`
          : `Not opening ${workspace.path}: it is ${refusal.why === "denied" ? "not readable" : "missing"}`,
    );
    return { kind: "refused", refusal };
  }
  for (const step of [
    ...(atLaunch ? migrateMachineSettings(userDataDir) : []),
    ...migrateWorkspaceSettings({
      packaged: app.isPackaged,
      userDataDir,
      workspace,
    }),
  ]) {
    logger.info(`Settings migration: ${step}`);
  }
  if (atLaunch) {
    // After the machine settings migration, which writes the store this
    // reads, and before anything asks the platform API: the server stays the
    // same for the life of the process. A launch for one server names it in
    // `INSTRUMENT_PLATFORM_API` (`studio-drive.mjs boot --account`), over the
    // choice in Settings, which it leaves as it was; only a development build
    // honors it.
    const launchServer = process.env.INSTRUMENT_PLATFORM_API;
    settlePlatformApiServer(
      launchServer
        ? { custom: launchServer }
        : getMachinePreferences().get("platformApiServer"),
    );
  }

  // After the settings migration, which brings what predates workspaces into
  // the folder this takes it from.
  const moved = moveMachineData({ userDataDir, workspace });
  for (const step of moved.done) {
    logger.info(`Machine data: ${step}`);
  }
  for (const step of cleanUpMachineData({
    machineDir: moved.machineDir,
    userDataDir,
    workspace,
  })) {
    logger.info(`Machine cleanup: ${step}`);
  }
  // After the cleanups, and before any store opens: the paths it moves are
  // written into the window's and the browser's stores (`registerAppStoredPaths`).
  const work = settleWorkFolders({
    machineDir: moved.machineDir,
    userDataDir,
    workspace,
  });
  for (const step of work.done) {
    logger.info(`Work folders: ${step}`);
  }
  setResolvedWorkspace({
    ...workspace,
    machineDir: moved.machineDir,
    workFoldersDir: work.workFoldersDir,
  });
  markWorkspaceOpen(moved.machineDir);
  return { kind: "open" };
}

/** Takes this process's open mark off the workspace it runs, where it has one. */
export function releaseWorkspaceOpenMark(): void {
  try {
    releaseOpenMark(getResolvedWorkspace().machineDir);
  } catch {
    // No workspace was opened: a refused one, or a process on its way out.
  }
}
