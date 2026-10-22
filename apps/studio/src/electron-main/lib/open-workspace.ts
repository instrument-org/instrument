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
import { type WorkspaceRun } from "./workspace-run";
import {
  claimUnplacedMachineDir,
  DEFAULT_WORKSPACE_ID,
  isFirstLaunch,
  type OpenWorkspace,
  type ResolvedWorkspace,
  resolveWorkspace,
  workspaceMachineDirOf,
} from "./workspaces";

/** Where the launch steps say what they did. */
interface LaunchLog {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/**
 * The first half of opening a workspace at launch, before any store opens:
 * settles which workspace this process runs, makes a move to a folder the
 * person picked, and brings the settings up to this build.
 *
 * The app runs only from a workspace the person chose, so a launch with no
 * folder to open opens none: a first launch (`isFirstLaunch`), and one whose
 * folder is lost (`inspectWorkspaceFolder`), which comes back with where it
 * was. Either answers the local id and this computer's folder for it, and
 * setup's folder step places it where the person picks or finds it
 * (`placeWorkspace`). A folder made by a newer build is refused, and nothing
 * else runs for it.
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
  | Extract<WorkspaceRun, { kind: "unplaced" }> {
  if (pin === undefined && isFirstLaunch(userDataDir)) {
    for (const step of migrateMachineSettings(userDataDir)) {
      log.info(`Settings migration: ${step}`);
    }
    log.info("No workspace yet: setup's first step places it");
    return {
      id: DEFAULT_WORKSPACE_ID,
      kind: "unplaced",
      machineDir: claimUnplacedMachineDir(userDataDir),
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
  const inspected = inspectWorkspaceFolder({ userDataDir, workspace });
  if (inspected === "lost") {
    for (const step of migrateMachineSettings(userDataDir)) {
      log.info(`Settings migration: ${step}`);
    }
    log.warn(
      `Not opening ${workspace.path}: it can't be opened there; setup asks for it`,
    );
    return {
      id: workspace.id,
      kind: "unplaced",
      lost: workspace.path,
      machineDir: workspaceMachineDirOf(userDataDir, workspace.id),
    };
  }
  if (inspected) {
    log.warn(`Not opening ${workspace.path}: a newer build made it`);
    return { kind: "refused", refusal: inspected };
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
