import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { app } from "electron";
import path from "node:path";

import { pathWithin } from "./path-identity";
import { getLocalWorkspace, getResolvedWorkspace } from "./workspace-run";

export function getWorkspaceFolder(): string {
  return getResolvedWorkspace().path;
}

/**
 * This computer's folder, Electron's userData: what is the machine's
 * whichever workspace is open (the update channel, caches, the registry of
 * workspaces), and each workspace's machine folder.
 */
export function getUserDataDir(): string {
  return app.getPath("userData");
}

/**
 * Whether the resolved workspace is kept in the app's own data (the default
 * one until the person picks a folder for it, and those made from the dev
 * panel) rather than in a folder the person picked, whose top level is
 * theirs: their finished work goes there.
 */
export function workspaceInAppData(): boolean {
  return pathWithin(getWorkspaceFolder(), getUserDataDir());
}

/**
 * This computer's folder for the resolved workspace,
 * `<userData>/machine/<local id>/`: what is secret, means something only
 * here, or is rebuilt here, none of which travels with it. There from the
 * start of a first launch, before setup gives the workspace its folder.
 */
export function workspaceMachineDir(): string {
  return getLocalWorkspace().machineDir;
}

/**
 * Where the resolved workspace's chats work on this computer,
 * `~/.instrument/work/<workspace>/`, a folder per chat.
 */
export function workspaceWorkFoldersDir(): string {
  return getResolvedWorkspace().workFoldersDir;
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
