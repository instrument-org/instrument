import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { WORKSPACE_LAYOUT_VERSION } from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

import { pathKey, pathWithin, samePath } from "./path-identity";
import {
  CURRENT_SETTINGS_VERSION,
  workspaceSettingsDirOf,
} from "./settings-migration";
import {
  createdWorkspacesDir,
  DEFAULT_WORKSPACE_ID,
  defaultWorkspacePath,
  hasWorkspaceIdentity,
  machineDirOwnedBy,
  openElsewhereBy,
  readRegistry,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  LOCAL_ID_LENGTH,
  settleWorkspace,
  updateRegistry,
  type WorkspaceIdentity,
  writeJsonAtomic,
  writeWorkspaceIdentity,
  WORKSPACE_FORMAT_VERSION,
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
  /**
   * Whether its folder is there to read: one on a disk not plugged in, or
   * one macOS stopped the app reading, is listed all the same.
   */
  isReachable: boolean;
  lastOpenedAt: null | number;
  /** Another live process holding it open, from its advisory mark. */
  openElsewhereBy: null | number;
  path: string;
}

/** What a file manager leaves in a folder it showed, which is no one's work. */
const FILE_MANAGER_RECORDS = new Set([".DS_Store", "desktop.ini", "Thumbs.db"]);

/**
 * The credential stores a new workspace can start from: who you are signed in
 * as, and your keys. A ChatGPT account is not one of them: its refresh token
 * rotates on every use, so two workspaces holding one copy would each spend it
 * and whichever refreshed second would be signed out (or both, if the provider
 * revokes the family). Connected apps stay behind too, since their tokens
 * belong to apps in the workspace they came from.
 */
const SIGN_IN_FILES = [
  "session-dev.json",
  "session.json.enc",
  "providers.json",
  "providers.json.enc",
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
  /** A keys folder whose sign-ins to copy, or none to start signed out. */
  copySignInsFrom: null | string;
  developerMode: boolean;
  name: string;
  userDataDir: string;
}): { id: string; path: string } {
  const base = slugify(name);
  let id = base;
  let dir = "";
  // Inside the locked update: the id is picked, the folder claimed, and the
  // entry added in one step, so two processes creating the same name at once
  // get two folders.
  updateRegistry(userDataDir, (current) => {
    for (
      let n = 2;
      current.workspaces.some((entry) => entry.id === id) ||
      fs.existsSync(path.join(createdWorkspacesDir(userDataDir), id));
      n++
    ) {
      id = `${base}-${n.toString()}`;
    }
    dir = path.join(createdWorkspacesDir(userDataDir), id);
    fs.mkdirSync(dir, { recursive: true });
    populateWorkspace({ color, dir, name });
    return {
      ...current,
      workspaces: [...current.workspaces, { id, path: dir }],
    };
  });
  // Outside the registry's lock, which settling the id takes.
  const machineDir = settleWorkspace({
    userDataDir,
    workspace: { id, path: dir },
  });
  writeJsonAtomic(
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.preferences),
    { developerMode },
  );
  if (copySignInsFrom) {
    copySignIns(copySignInsFrom, machineDir);
  }
  return { id, path: dir };
}

/**
 * Give a registered workspace whose folder cannot be read a new, empty one
 * in the app's own data, and make it the one opened next: under the same
 * local id and the same workspace id, so this computer's data for it
 * (sign-ins, keys, folder rules) carries on with it. The folder it could
 * not read is left as it is. Answers the new folder.
 */
export function startWorkspaceAfresh({
  id,
  userDataDir,
}: {
  id: string;
  userDataDir: string;
}): string {
  let dir = "";
  updateRegistry(userDataDir, (current) => {
    const entry = current.workspaces.find((other) => other.id === id);
    dir =
      id === DEFAULT_WORKSPACE_ID &&
      !fs.existsSync(defaultWorkspacePath(userDataDir))
        ? defaultWorkspacePath(userDataDir)
        : freeFolderIn(createdWorkspacesDir(userDataDir), id);
    populateWorkspace({
      color: "gray",
      dir,
      ...(entry?.workspaceId === undefined ? {} : { id: entry.workspaceId }),
      name: id === DEFAULT_WORKSPACE_ID ? "Default" : id,
    });
    return {
      active: id,
      workspaces: current.workspaces.map((other) => {
        if (other.id !== id) {
          return other;
        }
        const { pendingMove: _abandoned, ...rest } = other;
        return { ...rest, path: dir };
      }),
    };
  });
  return dir;
}

/** A folder of this name in `parent` no one has, numbered past those that are taken. */
function freeFolderIn(parent: string, name: string) {
  let dir = path.join(parent, name);
  for (let n = 2; fs.existsSync(dir); n++) {
    dir = path.join(parent, `${name}-${n.toString()}`);
  }
  return dir;
}

/**
 * Where a registered workspace's sign-ins are: in its machine folder, or for
 * one no build that keeps machine data apart has opened yet, still in its
 * settings folder.
 */
export function keysDirOf(
  userDataDir: string,
  workspace: { id: string; path: string },
): string {
  const machineDir = machineDirOwnedBy(userDataDir, workspace);
  return machineDir === undefined
    ? workspaceSettingsDirOf(workspace.path)
    : path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys);
}

/**
 * Every workspace this machine knows plus any found on disk unregistered. A
 * registered workspace whose folder cannot be reached is listed as such and
 * kept: a disk not plugged in, or a folder macOS stopped the app reading,
 * comes back, and only the person removing it from the list forgets it.
 */
export function listWorkspaces({
  resolved,
  userDataDir,
}: {
  resolved: ResolvedWorkspace;
  userDataDir: string;
}): WorkspaceListing[] {
  const registry = readRegistry(userDataDir);

  const listed: WorkspaceListing[] = registry.workspaces.map((entry) => {
    const isResolved = entry.id === resolved.id;
    return {
      id: entry.id,
      identity: readWorkspaceIdentity(entry.path),
      isDefault: entry.id === DEFAULT_WORKSPACE_ID,
      isReachable: isDirectory(entry.path),
      isRegistered: true,
      isResolved,
      lastOpenedAt: entry.lastOpenedAt ?? null,
      openElsewhereBy: isResolved
        ? null
        : openElsewhereBy(openMarkDirOf(userDataDir, entry)),
      path: entry.path,
    };
  });

  const registeredPaths = new Set(
    registry.workspaces.map((entry) => pathKey(entry.path)),
  );
  let strays: string[] = [];
  try {
    strays = fs
      .readdirSync(createdWorkspacesDir(userDataDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(createdWorkspacesDir(userDataDir), entry.name))
      .filter(
        (dir) =>
          !registeredPaths.has(pathKey(dir)) && hasWorkspaceIdentity(dir),
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
      isReachable: true,
      isRegistered: false,
      isResolved: false,
      lastOpenedAt: null,
      openElsewhereBy: openElsewhereBy(workspaceLayout(dir).dataDir),
      path: dir,
    })),
  ];
}

/**
 * Put a workspace found on disk back in the list. Only a folder the listing
 * offers as a stray, under `<userData>/workspaces/` with an identity and no
 * entry: anything else would let a path from the renderer become a workspace a
 * delete could then remove.
 */
export function registerStray({
  dir,
  resolved,
  userDataDir,
}: {
  dir: string;
  resolved: ResolvedWorkspace;
  userDataDir: string;
}): boolean {
  const stray = listWorkspaces({ resolved, userDataDir }).find(
    (listing) => !listing.isRegistered && samePath(listing.path, dir),
  );
  if (!stray) {
    return false;
  }
  updateRegistry(userDataDir, (current) => {
    const base = path.basename(stray.path);
    let id = base;
    for (let n = 2; current.workspaces.some((entry) => entry.id === id); n++) {
      id = `${base}-${n.toString()}`;
    }
    return {
      ...current,
      workspaces: [...current.workspaces, { id, path: stray.path }],
    };
  });
  return true;
}

/**
 * Remove a workspace's folder once deleting its `.instrument/` left nothing
 * of the person's in it; a file manager's own record of how it shows the
 * folder does not count. A folder holding anything else stays as it is.
 */
export function removeFolderIfEmpty(dir: string): void {
  try {
    const left = fs.readdirSync(dir);
    if (left.every((name) => FILE_MANAGER_RECORDS.has(name))) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  } catch {
    // Not there, or not readable: either way it stays as it is.
  }
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
      current.workspaces.find((entry) => samePath(entry.path, dir))?.id ===
      current.active
        ? DEFAULT_WORKSPACE_ID
        : current.active,
    workspaces: current.workspaces.filter(
      (entry) => !samePath(entry.path, dir),
    ),
  }));
}

/**
 * Why a workspace cannot be deleted right now, or null when it can. The
 * default workspace never can: it holds what predates workspaces, and the dev
 * panel offers no way to remove it. Nor can a folder that holds userData,
 * which a pinned `INSTRUMENT_WORKSPACE` such as the home folder registers:
 * a workspace there is never one made to be deleted, and the app's own data
 * sits beside its `.instrument/`.
 */
export function whyNotDeletable(
  listing: Pick<
    WorkspaceListing,
    "isDefault" | "isResolved" | "openElsewhereBy" | "path"
  >,
  userDataDir: string,
): null | string {
  if (listing.isDefault) {
    return "The default workspace cannot be deleted";
  }
  if (pathWithin(userDataDir, listing.path)) {
    return "This folder holds the app's own data";
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

/** Copy the sign-ins in a keys folder into a new workspace's machine folder. */
function copySignIns(fromDir: string, machineDir: string) {
  const keysDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys);
  for (const file of SIGN_IN_FILES) {
    if (fs.existsSync(path.join(fromDir, file))) {
      fs.mkdirSync(keysDir, { recursive: true });
      fs.copyFileSync(path.join(fromDir, file), path.join(keysDir, file));
    }
  }
}

/**
 * Where a registered workspace's open mark is: its machine folder, or for one
 * no build that keeps machine data apart has opened, the `.instrument/` an
 * older build running on it marks.
 */
function openMarkDirOf(
  userDataDir: string,
  workspace: { id: string; path: string },
): string {
  return (
    machineDirOwnedBy(userDataDir, workspace) ??
    workspaceLayout(workspace.path).dataDir
  );
}

/** Makes `dir` a new workspace, with no machine data or registry entry yet. */
export function populateWorkspace({
  color,
  dir,
  id,
  name,
}: {
  color: WorkspaceIdentity["color"];
  dir: string;
  /** The workspace's own id, for one that carries on another's. */
  id?: string;
  name: string;
}) {
  // Already at the current settings version, format and layout: there is
  // nothing legacy in a workspace made by this build, so no migration or
  // layout sweep ever runs on it.
  writeWorkspaceIdentity(dir, {
    color,
    createdBy: { kind: "person" },
    formatVersion: WORKSPACE_FORMAT_VERSION,
    ...(id === undefined ? {} : { id }),
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    legacyProjectsMigrated: true,
    name,
    settingsVersion: CURRENT_SETTINGS_VERSION,
  });
}

/** A local id from a name, kept short since it names the machine folder. */
function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .slice(0, LOCAL_ID_LENGTH)
      .replaceAll(/^-|-$/g, "") || "workspace"
  );
}
