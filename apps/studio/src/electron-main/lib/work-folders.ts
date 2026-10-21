import { claimWorkFolders } from "@instrument-org/workspace/work-folders";
import path from "node:path";

import { pathWithin } from "./path-identity";
import {
  defaultWorkspacePath,
  type ResolvedWorkspace,
  readWorkspaceIdentity,
} from "./workspaces";

/** Longest the readable part of a name gets, before its suffix. */
const LABEL_LENGTH = 40;

/**
 * What the workspace's folder in `~/.instrument/work/` is called before its
 * suffix, as the person knows the workspace: the folder they picked for it,
 * or for one in the app's own data, the name of that data folder
 * (`Instrument`, `Instrument (Dev)`, a preview's), which tells copies of the
 * app apart, followed by the workspace's own folder for one made from the
 * dev panel. Lowercase, with a hyphen for anything but letters and digits,
 * as a chat's folder is, so a path to it needs no quoting.
 */
export function workspaceLabel({
  userDataDir,
  workspacePath,
}: {
  userDataDir: string;
  workspacePath: string;
}): string {
  const label = !pathWithin(workspacePath, userDataDir)
    ? path.basename(workspacePath)
    : path.resolve(workspacePath) ===
        path.resolve(defaultWorkspacePath(userDataDir))
      ? path.basename(userDataDir)
      : `${path.basename(userDataDir)} ${path.basename(workspacePath)}`;
  return (
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .slice(0, LABEL_LENGTH)
      .replaceAll(/^-+|-+$/g, "") || "workspace"
  );
}

/**
 * Settles where the workspace's chats work on this computer,
 * `~/.instrument/work/<workspace>/`, named for the workspace as
 * {@link workspaceLabel} has it (`claimWorkFolders`). Runs at launch before
 * any store opens, and answers the folder.
 */
export function settleWorkFolders({
  home,
  machineDir,
  random,
  userDataDir,
  workspace,
}: {
  home?: string;
  machineDir: string;
  random?: () => string;
  userDataDir: string;
  workspace: Pick<ResolvedWorkspace, "path">;
}): { done: string[]; workFoldersDir: string } {
  return claimWorkFolders({
    home,
    label: () =>
      workspaceLabel({
        userDataDir,
        workspacePath: workspace.path,
      }),
    machineDir,
    random,
    workspaceId: () => readWorkspaceIdentity(workspace.path).id,
  });
}
