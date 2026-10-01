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
 * partway through finishes on the next boot, and nothing here throws.
 */

export const CURRENT_SETTINGS_VERSION = 1;

/** Electron-store names of the machine stores, at the root of userData. */
export const MACHINE_PREFERENCES_NAME = "machine-preferences";
export const MACHINE_STATE_NAME = "machine-state";

/** The legacy root files whose keys split between the two halves. */
const LEGACY_PREFERENCES = "preferences.json";
const LEGACY_APP_STATE = "app-state.json";

const MACHINE_PREFERENCE_KEYS = ["enableUsageMetrics", "releaseChannel"];
const MACHINE_STATE_KEYS_FROM_PREFERENCES = [
  "lastLaunchedVersion",
  "lastUpdateCheck",
];
const MACHINE_STATE_KEYS_FROM_APP_STATE = [
  "telemetryId",
  "lastMigratedVersion",
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
 * here on the two copies are independent. Both name sets are listed, since dev
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
 * Moved, never copied: the ChatGPT plan's refresh token rotates on every use,
 * so two holders of one copy would each spend it and one would be signed out.
 * An older build sharing this userData is the one that has to sign in again.
 */
const MOVED_FILES = ["chatgpt-plan.json", "chatgpt-plan.json.enc"];

export function appSessionDirOf(workspacePath: string): string {
  return path.join(workspacePrivateDir(workspacePath), "app-session");
}

/** Take the machine keys out of the legacy root files, which stay for the workspace half. */
export function migrateMachineSettings(userDataDir: string): string[] {
  const done: string[] = [];
  try {
    const preferences = readObject(path.join(userDataDir, LEGACY_PREFERENCES));
    const appState = readObject(path.join(userDataDir, LEGACY_APP_STATE));
    writeIfAbsent(
      path.join(userDataDir, `${MACHINE_PREFERENCES_NAME}.json`),
      pick(preferences, MACHINE_PREFERENCE_KEYS),
      done,
    );
    writeIfAbsent(
      path.join(userDataDir, `${MACHINE_STATE_NAME}.json`),
      {
        ...pick(preferences, MACHINE_STATE_KEYS_FROM_PREFERENCES),
        ...pick(appState, MACHINE_STATE_KEYS_FROM_APP_STATE),
      },
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
  userDataDir,
  workspace,
}: {
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

    if (workspace.isDefault) {
      takeInLegacyRootFiles(userDataDir, workspace.path, done);
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

function copyIfAbsent(from: string, to: string, done: string[]) {
  if (!fs.existsSync(from) || fs.existsSync(to)) {
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

function moveIfAbsent(from: string, to: string, done: string[]) {
  if (!fs.existsSync(from) || fs.existsSync(to)) {
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

function takeInLegacyRootFiles(
  userDataDir: string,
  workspacePath: string,
  done: string[],
) {
  const settingsDir = workspaceSettingsDirOf(workspacePath);
  const legacyPreferencesPath = path.join(userDataDir, LEGACY_PREFERENCES);
  const legacyAppStatePath = path.join(userDataDir, LEGACY_APP_STATE);

  writeIfAbsent(
    path.join(settingsDir, "preferences.json"),
    pick(readObject(legacyPreferencesPath), WORKSPACE_PREFERENCE_KEYS),
    done,
  );
  writeIfAbsent(
    path.join(settingsDir, "state.json"),
    pick(readObject(legacyAppStatePath), WORKSPACE_STATE_KEYS),
    done,
  );

  for (const name of COPIED_FILES) {
    copyIfAbsent(
      path.join(userDataDir, name),
      path.join(settingsDir, name),
      done,
    );
  }
  for (const name of MOVED_FILES) {
    moveIfAbsent(
      path.join(userDataDir, name),
      path.join(settingsDir, name),
      done,
    );
  }

  moveIfAbsent(
    path.join(userDataDir, "page-thumbnails"),
    pageThumbnailsDirOf(workspacePath),
    done,
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
    !fs.existsSync(workspaceLocalStorage)
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
) {
  if (fs.existsSync(filePath) || Object.keys(value).length === 0) {
    return;
  }
  writeJsonAtomic(filePath, value);
  done.push(`wrote ${path.basename(filePath)}`);
}
