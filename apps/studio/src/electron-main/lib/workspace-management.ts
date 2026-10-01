import fs from "node:fs";
import path from "node:path";

import { workspaceSettingsDirOf } from "./settings-migration";
import {
  createdWorkspacesDir,
  DEFAULT_WORKSPACE_ID,
  hasWorkspaceIdentity,
  openElsewhereBy,
  readRegistry,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  updateRegistry,
  type WorkspaceIdentity,
  writeJsonAtomic,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * Listing, creating, and removing workspaces, for the dev panel. Plain file
 * operations over the registry and the workspace folders; the RPC routes add
 * what needs Electron (the Trash, restarting).
 */

export interface WorkspaceListing {
  id: string;
  identity: WorkspaceIdentity;
  isDefault: boolean;
  /** Registered and in the list, or found on disk with nobody listing it. */
  isRegistered: boolean;
  isResolved: boolean;
  lastOpenedAt: null | number;
  /** Another live process holding it open, from its advisory mark. */
  openElsewhereBy: null | number;
  path: string;
}

/**
 * The credential stores a new workspace can start from: who you are signed in
 * as, your keys, and a ChatGPT plan. Connected apps stay behind, since their
 * tokens belong to apps in the workspace they came from.
 */
const SIGN_IN_FILES = [
  "session-dev.json",
  "session.json.enc",
  "providers.json",
  "providers.json.enc",
  "chatgpt-plan.json",
  "chatgpt-plan.json.enc",
];

/**
 * Make a workspace folder under `<userData>/workspaces/` and register it,
 * without switching to it. It starts with developer mode as the current
 * workspace has it, so a workspace made from the dev panel can reach the dev
 * panel, and one made some other way later does not inherit it by accident.
 */
export function createWorkspace({
  color,
  copySignInsFrom,
  developerMode,
  name,
  userDataDir,
}: {
  color: WorkspaceIdentity["color"];
  /** A workspace folder whose sign-ins to copy, or none to start signed out. */
  copySignInsFrom: null | string;
  developerMode: boolean;
  name: string;
  userDataDir: string;
}): { id: string; path: string } {
  const registry = readRegistry(userDataDir);
  const base = slugify(name);
  let id = base;
  for (
    let n = 2;
    registry.workspaces.some((entry) => entry.id === id) ||
    fs.existsSync(path.join(createdWorkspacesDir(userDataDir), id));
    n++
  ) {
    id = `${base}-${n.toString()}`;
  }
  const dir = path.join(createdWorkspacesDir(userDataDir), id);
  fs.mkdirSync(dir, { recursive: true });

  const settingsDir = workspaceSettingsDirOf(dir);
  writeJsonAtomic(path.join(settingsDir, "preferences.json"), {
    developerMode,
  });
  if (copySignInsFrom) {
    const fromDir = workspaceSettingsDirOf(copySignInsFrom);
    let copied = 0;
    for (const file of SIGN_IN_FILES) {
      if (fs.existsSync(path.join(fromDir, file))) {
        fs.copyFileSync(path.join(fromDir, file), path.join(settingsDir, file));
        copied++;
      }
    }
    if (copied > 0) {
      writeJsonAtomic(path.join(settingsDir, "state.json"), {
        hasCompletedProviderSetup: true,
      });
    }
  }

  // Written last and already at the current settings version: there is
  // nothing legacy in a workspace made by this build.
  writeWorkspaceIdentity(dir, {
    color,
    createdBy: { kind: "person" },
    name,
    settingsVersion: 1,
  });

  updateRegistry(userDataDir, (current) => ({
    ...current,
    workspaces: [...current.workspaces, { id, path: dir }],
  }));
  return { id, path: dir };
}

/**
 * Every workspace this machine knows plus any found on disk unregistered. A
 * registered workspace whose folder is gone is dropped from the registry as
 * it is listed: whoever removed the folder (Finder, studio-drive's reaping of
 * its clean rooms) meant it gone.
 */
export function listWorkspaces({
  resolved,
  userDataDir,
}: {
  resolved: ResolvedWorkspace;
  userDataDir: string;
}): WorkspaceListing[] {
  const registry = updateRegistry(userDataDir, (current) => ({
    ...current,
    workspaces: current.workspaces.filter(
      (entry) => entry.id === DEFAULT_WORKSPACE_ID || isDirectory(entry.path),
    ),
  }));

  const listed: WorkspaceListing[] = registry.workspaces.map((entry) => ({
    id: entry.id,
    identity: readWorkspaceIdentity(entry.path),
    isDefault: entry.id === DEFAULT_WORKSPACE_ID,
    isRegistered: true,
    isResolved: entry.id === resolved.id,
    lastOpenedAt: entry.lastOpenedAt ?? null,
    openElsewhereBy:
      entry.id === resolved.id ? null : openElsewhereBy(entry.path),
    path: entry.path,
  }));

  const registeredPaths = new Set(
    registry.workspaces.map((entry) => path.resolve(entry.path)),
  );
  let strays: string[] = [];
  try {
    strays = fs
      .readdirSync(createdWorkspacesDir(userDataDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(createdWorkspacesDir(userDataDir), entry.name))
      .filter(
        (dir) =>
          !registeredPaths.has(path.resolve(dir)) && hasWorkspaceIdentity(dir),
      );
  } catch {
    // No workspaces folder yet.
  }

  return [
    ...listed,
    ...strays.map((dir) => ({
      id: path.basename(dir),
      identity: readWorkspaceIdentity(dir),
      isDefault: false,
      isRegistered: false,
      isResolved: false,
      lastOpenedAt: null,
      openElsewhereBy: openElsewhereBy(dir),
      path: dir,
    })),
  ];
}

/** Put a workspace found on disk back in the list. */
export function registerStray({
  dir,
  userDataDir,
}: {
  dir: string;
  userDataDir: string;
}): void {
  updateRegistry(userDataDir, (current) => {
    let id = path.basename(dir);
    for (let n = 2; current.workspaces.some((entry) => entry.id === id); n++) {
      id = `${path.basename(dir)}-${n.toString()}`;
    }
    return {
      ...current,
      workspaces: [...current.workspaces, { id, path: dir }],
    };
  });
}

export function unregisterWorkspace({
  dir,
  userDataDir,
}: {
  dir: string;
  userDataDir: string;
}): void {
  updateRegistry(userDataDir, (current) => ({
    active:
      current.workspaces.find(
        (entry) => path.resolve(entry.path) === path.resolve(dir),
      )?.id === current.active
        ? DEFAULT_WORKSPACE_ID
        : current.active,
    workspaces: current.workspaces.filter(
      (entry) => path.resolve(entry.path) !== path.resolve(dir),
    ),
  }));
}

/**
 * Why a workspace cannot be deleted right now, or null when it can. The
 * default workspace never can: it holds what predates workspaces, and the dev
 * panel offers no way to remove it.
 */
export function whyNotDeletable(
  listing: Pick<
    WorkspaceListing,
    "isDefault" | "isResolved" | "openElsewhereBy"
  >,
): null | string {
  if (listing.isDefault) {
    return "The default workspace cannot be deleted";
  }
  if (listing.isResolved) {
    return "Switch to another workspace before deleting this one";
  }
  if (listing.openElsewhereBy !== null) {
    return `Open in another process (pid ${listing.openElsewhereBy.toString()})`;
  }
  return null;
}

function isDirectory(dir: string) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "workspace"
  );
}
