import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { app } from "electron";
import path from "node:path";

import { getResolvedWorkspace, workspacePrivateDir } from "./workspaces";

export function getWorkspaceFolder(): string {
  return getResolvedWorkspace().path;
}

/**
 * This computer's folder, Electron's userData: what is the machine's
 * whichever workspace is open (the update channel, caches, the registry of
 * workspaces), and each workspace's machine folder.
 */
export function machineDir(): string {
  return app.getPath("userData");
}

/**
 * What the app keeps for the resolved workspace that travels with it,
 * `<workspace>/.instrument/`: its identity, the person's preferences and
 * flags, their bookmarks.
 */
export function workspaceDataDir(): string {
  return workspacePrivateDir(getWorkspaceFolder());
}

/**
 * This computer's folder for the resolved workspace,
 * `<userData>/workspaces-data/<local id>/`: what is secret, means
 * something only here, or is rebuilt here, none of which travels with it.
 */
export function workspaceMachineDir(): string {
  return getResolvedWorkspace().machineDir;
}

/** The workspace's secrets on this computer: keys, sign-ins, app credentials. */
export function workspaceKeysDir(): string {
  return path.join(workspaceMachineDir(), WORKSPACE_MACHINE_ENTRIES.keys);
}

/** The Chromium profiles of the app and its browser, and what the browser keeps beside them. */
export function workspaceBrowserDir(): string {
  return path.join(workspaceMachineDir(), WORKSPACE_MACHINE_ENTRIES.browser);
}

/** The window's size and place, and where the person left off in it. */
export function workspaceWindowDir(): string {
  return path.join(workspaceMachineDir(), WORKSPACE_MACHINE_ENTRIES.window);
}
