import path from "node:path";

import { settleMachineFolders } from "./open-workspace";
import {
  CURRENT_SETTINGS_VERSION,
  migrateWorkspaceSettings,
} from "./settings-migration";
import { populateWorkspace } from "./workspace-management";
import { type WorkspaceRun } from "./workspace-run";
import {
  DEFAULT_WORKSPACE_ID,
  hasWorkspaceIdentity,
  MACHINE_DATA_FORMAT_VERSION,
  type OpenWorkspace,
  readOwner,
  readRegistry,
  readWorkspaceIdentity,
  registerWorkspaceFolder,
  type ResolvedWorkspace,
  updateRegistry,
} from "./workspaces";

type Unplaced = Extract<WorkspaceRun, { kind: "unplaced" }>;

/**
 * Whether the folder setup's folder step picked can become the workspace in
 * this process, or needs a restart: `here` for a new workspace, or for one
 * already in the folder that this launch's local id can take as it is.
 * Otherwise the restart's registry entry is recorded and made the one to
 * open, and the answer names its local id:
 *
 * - the same workspace as another entry on this computer (by the id in its
 *   `workspace.json`), whose own folder no longer holds it, re-points that
 *   entry, so its machine folder and sign-ins carry on;
 * - a different workspace, while this local id's machine folder is another
 *   workspace's (one whose folder went missing), gets a local id of its own;
 * - one an earlier build left in an older format is opened by a launch, whose
 *   migrations move its machine data with nothing open, under this local id
 *   when it can take it.
 */
export function choosePlacement({
  dir,
  unplaced,
  userDataDir,
}: {
  dir: string;
  unplaced: Unplaced;
  userDataDir: string;
}): { id: string; kind: "restart" } | { kind: "here" } {
  if (!hasWorkspaceIdentity(dir)) {
    return { kind: "here" };
  }
  const identity = readWorkspaceIdentity(dir);
  const registry = readRegistry(userDataDir);
  const elsewhere =
    identity.id !== undefined &&
    registry.workspaces.some(
      (entry) => entry.id !== unplaced.id && entry.workspaceId === identity.id,
    );
  const owner = readOwner(unplaced.machineDir);
  const ours =
    !elsewhere &&
    (owner === undefined ||
      (identity.id !== undefined && identity.id === owner));
  const current =
    identity.formatVersion >= MACHINE_DATA_FORMAT_VERSION &&
    identity.settingsVersion >= CURRENT_SETTINGS_VERSION;
  if (ours && current) {
    return { kind: "here" };
  }
  let id: string;
  if (ours) {
    id = unplaced.id;
    const folder = path.resolve(dir);
    updateRegistry(userDataDir, (now) => ({
      active: id,
      workspaces: [
        {
          ...now.workspaces.find((entry) => entry.id === id),
          id,
          path: folder,
        },
        ...now.workspaces.filter((entry) => entry.id !== id),
      ],
    }));
  } else {
    const registered = registerWorkspaceFolder({ dir, userDataDir });
    if (registered === undefined) {
      return { kind: "here" };
    }
    ({ id } = registered);
    updateRegistry(userDataDir, (now) => ({ ...now, active: id }));
  }
  return { id, kind: "restart" };
}

/**
 * Gives an unplaced workspace its folder, `dir`, which is there, was checked
 * for a place a workspace can be, and can be placed in this process
 * (`choosePlacement`): a new workspace made in it, or the workspace already
 * in it opened. Registered under the local id the launch already uses, so
 * the machine folder the window's session lives in stays its own (with the
 * sign-ins of a workspace whose folder went missing), and made the one to
 * open next. Then the rest of a launch's opening runs, as for any workspace
 * (the settings brought up to this build, the machine data settled).
 * Answers the workspace as opened, for the caller to run (`placeRun`).
 */
export function placeWorkspace({
  dir,
  home,
  log,
  now = Date.now(),
  packaged,
  unplaced,
  userDataDir,
}: {
  dir: string;
  /** Where its chats' work folders go, for a test (`settleMachineFolders`). */
  home?: string;
  log: { info: (message: string) => void; warn: (message: string) => void };
  now?: number;
  /** Whether this is a packaged build (`migrateWorkspaceSettings`). */
  packaged: boolean;
  unplaced: Unplaced;
  userDataDir: string;
}): OpenWorkspace {
  const folder = path.resolve(dir);
  const opening = hasWorkspaceIdentity(folder);
  if (!opening) {
    // Named after its folder, so two workspaces read apart wherever their
    // names show.
    populateWorkspace({
      color: "gray",
      dir: folder,
      name: path.basename(folder),
    });
  }
  updateRegistry(userDataDir, (current) => {
    const entry = {
      ...current.workspaces.find((other) => other.id === unplaced.id),
      id: unplaced.id,
      lastOpenedAt: now,
      path: folder,
    };
    return {
      active: unplaced.id,
      workspaces: [
        entry,
        ...current.workspaces.filter((other) => other.id !== unplaced.id),
      ],
    };
  });
  log.info(
    `Workspace ${unplaced.id}: ${opening ? "opened" : "made"} at ${folder}`,
  );
  const workspace: ResolvedWorkspace = {
    id: unplaced.id,
    isDefault: unplaced.id === DEFAULT_WORKSPACE_ID,
    path: folder,
    pinned: false,
  };
  for (const step of migrateWorkspaceSettings({
    packaged,
    userDataDir,
    workspace,
  })) {
    log.info(`Settings migration: ${step}`);
  }
  return settleMachineFolders({ home, log, userDataDir, workspace });
}
