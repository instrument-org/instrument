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
  claimUnplacedMachineDir,
  DEFAULT_WORKSPACE_ID,
  needsPlacing,
  type OpenWorkspace,
  type ResolvedWorkspace,
  resolveWorkspace,
  type UnplacedWorkspace,
} from "./workspaces";

/** Where the launch steps say what they did. */
interface LaunchLog {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/**
 * The first half of opening a workspace at launch, before any store opens:
 * settles which workspace this process runs, makes a move to a folder the
 * person picked, refuses a folder it cannot open, and brings the settings up
 * to this build. A refused workspace comes back with why, and nothing else
 * runs for it.
 *
 * A launch with no workspace to open (`needsPlacing`), a first launch
 * above all, opens none: it answers the local id the workspace will have
 * and this computer's folder for it, and setup's first step places the
 * workspace where the person picks (`placeWorkspace`).
 */
export function resolveLaunchWorkspace({
  log,
  packaged,
  pin,
  userDataDir,
}: {
  log: LaunchLog;
  /** Whether this is a packaged build (`migrateWorkspaceSettings`). */
  packaged: boolean;
  /** `INSTRUMENT_WORKSPACE`: a registered id or an absolute path. */
  pin: string | undefined;
  userDataDir: string;
}):
  | { kind: "open"; workspace: ResolvedWorkspace }
  | { kind: "refused"; refusal: WorkspaceRefusal }
  | { kind: "unplaced"; workspace: UnplacedWorkspace } {
  if (pin === undefined && needsPlacing(userDataDir)) {
    for (const step of migrateMachineSettings(userDataDir)) {
      log.info(`Settings migration: ${step}`);
    }
    const machineDir = claimUnplacedMachineDir(userDataDir);
    log.info("No workspace yet: setup's first step places it");
    return {
      kind: "unplaced",
      workspace: { id: DEFAULT_WORKSPACE_ID, machineDir },
    };
  }
  const resolved = resolveWorkspace({ pin, userDataDir });
  for (const problem of resolved.problems) {
    log.warn(problem);
  }
  const { done: moveSteps, workspace } = finishPendingMove({
    userDataDir,
    workspace: resolved.workspace,
  });
  for (const step of moveSteps) {
    log.info(`Workspace move: ${step}`);
  }
  log.info(
    `Workspace ${workspace.id}${workspace.pinned ? " (pinned)" : ""}: ${workspace.path}`,
  );
  // A folder made by a newer build, one that cannot be read, or one in a
  // place no workspace can be is not opened: the boot says so in a window of
  // its own and starts nothing else.
  const refusal = inspectWorkspaceFolder({ userDataDir, workspace });
  if (refusal) {
    log.warn(
      refusal.kind === "newer"
        ? `Not opening ${workspace.path}: a newer build made it`
        : refusal.kind === "misplaced"
          ? `Not opening ${workspace.path}: no workspace can be there (${refusal.reason})`
          : `Not opening ${workspace.path}: it is ${refusal.why === "denied" ? "not readable" : "missing"}`,
    );
    return { kind: "refused", refusal };
  }
  for (const step of [
    ...migrateMachineSettings(userDataDir),
    ...migrateWorkspaceSettings({
      packaged,
      userDataDir,
      workspace,
    }),
  ]) {
    log.info(`Settings migration: ${step}`);
  }
  return { kind: "open", workspace };
}

/**
 * The second half, after the settings migration: moves what is this
 * computer's own into the workspace's machine folder, cleans that folder
 * up, and settles its work folders, under `home` when one is given
 * (`claimWorkFolders`). Answers the workspace as the process opens it.
 */
export function settleMachineFolders({
  home,
  log,
  userDataDir,
  workspace,
}: {
  home?: string;
  log: LaunchLog;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): OpenWorkspace {
  // After the settings migration, which brings what predates workspaces into
  // the folder this takes it from.
  const moved = moveMachineData({ userDataDir, workspace });
  for (const step of moved.done) {
    log.info(`Machine data: ${step}`);
  }
  for (const step of cleanUpMachineData({
    machineDir: moved.machineDir,
    userDataDir,
    workspace,
  })) {
    log.info(`Machine cleanup: ${step}`);
  }
  // After the cleanups, and before any store opens: the paths it moves are
  // written into the window's and the browser's stores (`registerAppStoredPaths`).
  const work = settleWorkFolders({
    home,
    machineDir: moved.machineDir,
    userDataDir,
    workspace,
  });
  for (const step of work.done) {
    log.info(`Work folders: ${step}`);
  }
  return {
    ...workspace,
    machineDir: moved.machineDir,
    workFoldersDir: work.workFoldersDir,
  };
}
