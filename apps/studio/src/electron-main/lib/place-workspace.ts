import path from "node:path";

import { settleMachineFolders } from "./open-workspace";
import { migrateWorkspaceSettings } from "./settings-migration";
import { populateWorkspace } from "./workspace-management";
import {
  DEFAULT_WORKSPACE_ID,
  hasWorkspaceIdentity,
  type OpenWorkspace,
  type ResolvedWorkspace,
  setResolvedWorkspace,
  type UnplacedWorkspace,
  updateRegistry,
} from "./workspaces";

/**
 * Gives a first launch's workspace its folder, `dir`, which is there and was
 * checked for a place a workspace can be: a new workspace made in it, or the
 * workspace already in it opened. Registered under the local id the launch
 * already uses, so the machine folder the window's session and setup's
 * sign-ins live in becomes its own, and made the one to open next. Then the
 * rest of a launch's opening runs, as for any workspace (the settings brought
 * up to this build, the machine data settled), and the process runs it from
 * here on. Answers the workspace as opened.
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
  unplaced: UnplacedWorkspace;
  userDataDir: string;
}): OpenWorkspace {
  const folder = path.resolve(dir);
  const opening = hasWorkspaceIdentity(folder);
  if (!opening) {
    populateWorkspace({ color: "gray", dir: folder, name: "Default" });
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
  const opened = settleMachineFolders({ home, log, userDataDir, workspace });
  setResolvedWorkspace(opened);
  return opened;
}
