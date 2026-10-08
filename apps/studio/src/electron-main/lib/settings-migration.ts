import fs from "node:fs";
import path from "node:path";

import {
  hasWorkspaceIdentity,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  workspacePrivateDir,
  writeJsonAtomic,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * Brings settings written before workspaces existed into the shape this build
 * reads: machine stores at the root of userData, workspace stores under
 * `<workspace>/.instrument/settings/`.
 *
 * The machine half runs on every boot and does nothing once its files exist.
 * The workspace half runs only for the workspace this process resolved, so a
 * workspace nobody opens is never touched; when a later build opens it, it
 * takes the same path then. Every step skips once its target exists, so a crash
 * partway through finishes on the next boot, and nothing here throws. The one
 * exception is a take-in that stopped partway: the stores then open at the new
 * location and write their defaults there, so the retry overwrites targets
 * rather than keeping those defaults over the user's legacy files.
 */

const CURRENT_SETTINGS_VERSION = 1;

/** Electron-store names of the machine stores, at the root of userData. */
export const MACHINE_PREFERENCES_NAME = "machine-preferences";
export const MACHINE_STATE_NAME = "machine-state";

/** The legacy root files whose keys split between the two halves. */
const LEGACY_PREFERENCES = "preferences.json";
const LEGACY_APP_STATE = "app-state.json";

const MACHINE_PREFERENCE_KEYS = ["releaseChannel"];
const MACHINE_STATE_KEYS_FROM_PREFERENCES = [
  "lastLaunchedVersion",
  "lastUpdateCheck",
];
const WORKSPACE_PREFERENCE_KEYS = [
  "agentCompletionNotifications",
  "defaultModelURI",
  "developerMode",
  "theme",
];
const WORKSPACE_STATE_KEYS = ["hasCompletedProviderSetup"];

/**
 * Root files that belong wholly to the default workspace, copied as they are.
 * Copied rather than moved so an older build sharing this userData (another
 * worktree on the shared dev directory, or a downgrade) still finds them; from
 * here on the two copies are independent. A packaged build then removes the
 * root copies of the ones holding secrets ({@link PACKAGED_SECRET_FILES}). Both name sets are listed, since dev
 * builds write plaintext (`session-dev`) and packaged builds write safeStorage
 * ciphertext (`.json.enc`); a byte copy stays readable under the same key.
 */
const COPIED_FILES = [
  "session-dev.json",
  "session.json.enc",
  "providers.json",
  "providers.json.enc",
  "app-oauth.json",
  "app-oauth.json.enc",
  "app-credentials.json",
  "app-credentials.json.enc",
  "app-connections.json",
  "features.json",
  "window-state.json",
];

/**
 * The copied files that hold secrets in a packaged build. A packaged build
 * deletes its root copies once the workspace holds them, so a signed-in session
 * or a key does not outlive a sign-out or a disconnect in a file nothing reads.
 * Dev builds keep them, since every checkout on the machine shares one dev
 * userData and an older one may still read them.
 */
const PACKAGED_SECRET_FILES = [
  "session.json.enc",
  "providers.json.enc",
  "app-oauth.json.enc",
  "app-credentials.json.enc",
];

/**
 * Moved, never copied: the ChatGPT account's refresh token rotates on every use,
 * so two holders of one copy would each spend it and one would be signed out.
 * An older build sharing this userData is the one that has to sign in again.
 */
const MOVED_FILES = ["chatgpt-account.json", "chatgpt-account.json.enc"];

/**
 * Present while the legacy take-in runs, removed once the version is written,
 * so a boot that finds it knows the last take-in stopped partway.
 */
const TAKE_IN_MARKER = ".take-in-unfinished";

export function appSessionDirOf(workspacePath: string): string {
  return path.join(workspacePrivateDir(workspacePath), "app-session");
}

/** Take the machine keys out of the legacy root files, which stay for the workspace half. */
export function migrateMachineSettings(userDataDir: string): string[] {
  const done: string[] = [];
  try {
    const preferences = readObject(path.join(userDataDir, LEGACY_PREFERENCES));
    writeIfAbsent(
      path.join(userDataDir, `${MACHINE_PREFERENCES_NAME}.json`),
      pick(preferences, MACHINE_PREFERENCE_KEYS),
      done,
    );
    writeIfAbsent(
      path.join(userDataDir, `${MACHINE_STATE_NAME}.json`),
      pick(preferences, MACHINE_STATE_KEYS_FROM_PREFERENCES),
      done,
    );
  } catch (error) {
    done.push(`machine settings migration stopped: ${String(error)}`);
  }
  return done;
}

/**
 * Bring the resolved workspace up to {@link CURRENT_SETTINGS_VERSION}. Only the
 * default workspace has anything legacy to take in: the root files predate
 * every other workspace.
 */
export function migrateWorkspaceSettings({
  packaged,
  userDataDir,
  workspace,
}: {
  /** Whether this is a packaged build, which removes the root copies of {@link PACKAGED_SECRET_FILES}. */
  packaged: boolean;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): string[] {
  const done: string[] = [];
  try {
    const hadIdentity = hasWorkspaceIdentity(workspace.path);
    const identity = readWorkspaceIdentity(workspace.path);
    if (identity.settingsVersion >= CURRENT_SETTINGS_VERSION) {
      return done;
    }

    const marker = path.join(
      workspaceSettingsDirOf(workspace.path),
      TAKE_IN_MARKER,
    );
    if (workspace.isDefault) {
      const overwrite = fs.existsSync(marker);
      writeJsonAtomic(marker, { pid: process.pid });
      takeInLegacyRootFiles({
        done,
        overwrite,
        packaged,
        userDataDir,
        workspacePath: workspace.path,
      });
    }

    writeWorkspaceIdentity(workspace.path, {
      ...identity,
      // A folder pinned from outside with nothing to say about itself is
      // named after the folder.
      name: workspace.isDefault
        ? "Default"
        : hadIdentity
          ? identity.name
          : path.basename(workspace.path),
      settingsVersion: CURRENT_SETTINGS_VERSION,
    });
    fs.rmSync(marker, { force: true });
    done.push(`settings at version ${CURRENT_SETTINGS_VERSION.toString()}`);
  } catch (error) {
    done.push(`workspace settings migration stopped: ${String(error)}`);
  }
  return done;
}

export function pageThumbnailsDirOf(workspacePath: string): string {
  return path.join(workspacePrivateDir(workspacePath), "page-thumbnails");
}

export function workspaceSettingsDirOf(workspacePath: string): string {
  return path.join(workspacePrivateDir(workspacePath), "settings");
}

/**
 * Whether `to` stays as it is. With `overwrite`, an existing target is removed
 * so the caller writes it again.
 */
function keepTarget(to: string, overwrite: boolean): boolean {
  if (!fs.existsSync(to)) {
    return false;
  }
  if (!overwrite) {
    return true;
  }
  fs.rmSync(to, { force: true, recursive: true });
  return false;
}

function copyIfAbsent(
  from: string,
  to: string,
  done: string[],
  overwrite: boolean,
) {
  if (!fs.existsSync(from) || keepTarget(to, overwrite)) {
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Through a sibling, so a crash mid-copy never leaves a half file that the
  // "target exists" check would then keep.
  const partial = `${to}.partial-${process.pid.toString()}`;
  fs.copyFileSync(from, partial);
  fs.renameSync(partial, to);
  done.push(`copied ${path.basename(from)}`);
}

function moveIfAbsent(
  from: string,
  to: string,
  done: string[],
  overwrite: boolean,
) {
  if (!fs.existsSync(from) || keepTarget(to, overwrite)) {
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  done.push(`moved ${path.basename(from)}`);
}

function pick(
  source: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      source?.[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

function readObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? { ...parsed }
      : undefined;
  } catch {
    return undefined;
  }
}

function takeInLegacyRootFiles({
  done,
  overwrite,
  packaged,
  userDataDir,
  workspacePath,
}: {
  done: string[];
  overwrite: boolean;
  packaged: boolean;
  userDataDir: string;
  workspacePath: string;
}) {
  const settingsDir = workspaceSettingsDirOf(workspacePath);
  const legacyPreferencesPath = path.join(userDataDir, LEGACY_PREFERENCES);
  const legacyAppStatePath = path.join(userDataDir, LEGACY_APP_STATE);

  writeIfAbsent(
    path.join(settingsDir, "preferences.json"),
    pick(readObject(legacyPreferencesPath), WORKSPACE_PREFERENCE_KEYS),
    done,
    overwrite,
  );
  writeIfAbsent(
    path.join(settingsDir, "state.json"),
    pick(readObject(legacyAppStatePath), WORKSPACE_STATE_KEYS),
    done,
    overwrite,
  );

  for (const name of COPIED_FILES) {
    copyIfAbsent(
      path.join(userDataDir, name),
      path.join(settingsDir, name),
      done,
      overwrite,
    );
  }
  if (packaged) {
    for (const name of PACKAGED_SECRET_FILES) {
      const from = path.join(userDataDir, name);
      if (fs.existsSync(from) && fs.existsSync(path.join(settingsDir, name))) {
        fs.rmSync(from, { force: true });
        done.push(`removed the root copy of ${name}`);
      }
    }
  }
  for (const name of MOVED_FILES) {
    moveIfAbsent(
      path.join(userDataDir, name),
      path.join(settingsDir, name),
      done,
      overwrite,
    );
  }

  moveIfAbsent(
    path.join(userDataDir, "page-thumbnails"),
    pageThumbnailsDirOf(workspacePath),
    done,
    overwrite,
  );

  // The app window ran on Electron's default session before it ran on the
  // workspace's own, so its localStorage (tabs, drafts, history) is copied
  // across. Copied, not moved: the default session still owns that directory,
  // and an older build still reads it. Copied beside the target and renamed
  // into place, so a crash partway leaves no half database that the "target
  // exists" check would then keep forever.
  const legacyLocalStorage = path.join(userDataDir, "Local Storage");
  const workspaceLocalStorage = path.join(
    appSessionDirOf(workspacePath),
    "Local Storage",
  );
  if (
    fs.existsSync(legacyLocalStorage) &&
    !keepTarget(workspaceLocalStorage, overwrite)
  ) {
    const partial = `${workspaceLocalStorage}.partial-${process.pid.toString()}`;
    fs.rmSync(partial, { force: true, recursive: true });
    fs.cpSync(legacyLocalStorage, partial, { recursive: true });
    fs.renameSync(partial, workspaceLocalStorage);
    done.push("copied Local Storage");
  }
}

/** Write `value` as a new store file, unless one is already there. */
function writeIfAbsent(
  filePath: string,
  value: Record<string, unknown>,
  done: string[],
  overwrite = false,
) {
  if (Object.keys(value).length === 0 || keepTarget(filePath, overwrite)) {
    return;
  }
  writeJsonAtomic(filePath, value);
  done.push(`wrote ${path.basename(filePath)}`);
}
