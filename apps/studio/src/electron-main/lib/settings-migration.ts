import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

import { freeNameIn } from "../drafts/draft-store";
import { pathWithin } from "./path-identity";

import {
  hasWorkspaceIdentity,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  WORKSPACE_FORMAT_VERSION,
  writeJsonAtomic,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * Brings settings written before workspaces existed into the shape the
 * machine data move (`machine-data-migration.ts`), which runs next, takes
 * from: machine stores at the root of userData, workspace stores under
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
 *
 * Version 2 moves a workspace's drafts out of its settings into a folder each
 * in its drafts folder.
 */

export const CURRENT_SETTINGS_VERSION = 2;

/** Electron-store names of the machine stores, at the root of userData. */
export const MACHINE_PREFERENCES_NAME = "machine-preferences";
export const MACHINE_STATE_NAME = "machine-state";

/** The legacy root file whose keys split between the two halves. */
const LEGACY_PREFERENCES = "preferences.json";

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
 * Dev builds keep them here, since every checkout on the machine shares one dev
 * userData and an older one may still read them; the machine data move removes
 * them in every build once the workspace's keys hold them
 * (`machine-data-migration.ts`).
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

/** Whether the legacy take-in into `workspacePath` stopped partway and has yet to finish. */
export function takeInUnfinished(workspacePath: string): boolean {
  return fs.existsSync(
    path.join(workspaceSettingsDirOf(workspacePath), TAKE_IN_MARKER),
  );
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
    // Only the default workspace in the app's own data predates workspaces:
    // the root files are its, and the app made its folder.
    const inAppData =
      workspace.isDefault && pathWithin(workspace.path, userDataDir);
    const identity = readWorkspaceIdentity(workspace.path);
    if (identity.settingsVersion >= CURRENT_SETTINGS_VERSION) {
      return done;
    }

    if (identity.settingsVersion < 1) {
      const marker = path.join(
        workspaceSettingsDirOf(workspace.path),
        TAKE_IN_MARKER,
      );
      if (inAppData) {
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
        // A folder no build made a workspace of holds nothing kept in an
        // older format, so it starts at this one, and the machine data move
        // never takes the person's own top-level files for the app's.
        ...(hadIdentity || inAppData
          ? {}
          : { formatVersion: WORKSPACE_FORMAT_VERSION }),
        // A folder pinned from outside with nothing to say about itself is
        // named after the folder.
        name: inAppData
          ? "Default"
          : hadIdentity
            ? identity.name
            : path.basename(workspace.path),
        settingsVersion: 1,
      });
      fs.rmSync(marker, { force: true });
    }

    moveKeptDraftsToFolders(workspace.path, done);

    writeWorkspaceIdentity(workspace.path, {
      ...readWorkspaceIdentity(workspace.path),
      settingsVersion: CURRENT_SETTINGS_VERSION,
    });
    done.push(`settings at version ${CURRENT_SETTINGS_VERSION.toString()}`);
  } catch (error) {
    done.push(`workspace settings migration stopped: ${String(error)}`);
  }
  return done;
}

/** The key the beta kept its drafts under, in `drafts.json`. */
const KEPT_DRAFTS_KEY = "drafts.v2";

/**
 * Version 2: a 2.0 beta kept the drafts as one list in the settings'
 * `drafts.json`, and what was pasted into each in `.instrument/drafts/<id>/`
 * one folder per item. Each draft becomes a folder of its own in the
 * workspace's drafts folder, with what was pasted into it beside its words.
 * A draft whose folder is already there is left as it is. `history.json`,
 * which kept a list nothing reads any longer, goes too.
 *
 * The beta's staging folder is the drafts folder itself, so of it only the
 * item folders the kept list names go, and a draft's folder only once that
 * leaves it empty: a draft kept there since is never touched.
 */
function moveKeptDraftsToFolders(workspacePath: string, done: string[]) {
  const settingsDir = workspaceSettingsDirOf(workspacePath);
  const keptFile = path.join(settingsDir, "drafts.json");
  const root = workspaceLayout(workspacePath).draftsDir;
  const stagedItems = new Set<string>();
  const kept = readObject(keptFile)?.[KEPT_DRAFTS_KEY];
  if (Array.isArray(kept) && kept.length > 0) {
    for (const draft of kept) {
      for (const file of stagedFilesOf(root, draft)) {
        stagedItems.add(file.itemDir);
      }
    }
    const present = new Set(
      (fs.existsSync(root) ? fs.readdirSync(root) : []).filter((name) =>
        fs.existsSync(
          path.join(root, name, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
        ),
      ),
    );
    const moved = kept.flatMap((draft: unknown) => {
      if (
        !isObject(draft) ||
        typeof draft.id !== "string" ||
        present.has(draft.id)
      ) {
        return [];
      }
      const dir = path.join(root, draft.id);
      const staged = new Set(
        stagedFilesOf(root, draft).map((file) => file.path),
      );
      const attached = Array.isArray(draft.attached)
        ? draft.attached.map((item: unknown) => {
            if (
              !isObject(item) ||
              typeof item.path !== "string" ||
              !staged.has(item.path) ||
              !fs.existsSync(item.path)
            ) {
              return item;
            }
            fs.mkdirSync(dir, { recursive: true });
            const to = path.join(
              dir,
              freeNameIn(dir, path.basename(item.path)),
            );
            fs.renameSync(item.path, to);
            return { ...item, path: to };
          })
        : undefined;
      return [{ ...draft, ...(attached ? { attached } : {}) }];
    });
    for (const draft of moved) {
      writeDraftToFolder(root, draft);
    }
    done.push(`moved ${moved.length.toString()} drafts into their folders`);
  }
  for (const itemDir of stagedItems) {
    fs.rmSync(itemDir, { force: true, recursive: true });
    removeIfEmpty(path.dirname(itemDir));
  }
  fs.rmSync(keptFile, { force: true });
  fs.rmSync(path.join(settingsDir, "history.json"), { force: true });
}

/**
 * One draft in a folder of its own under the drafts folder, in the shape the
 * build after the beta read: its words in `draft.md` and the rest of its
 * record in its own `.instrument/settings.json`. The drafts move again from
 * there, out to `Drafts/` at the workspace's top level
 * (`lib/drafts/migrate.ts`), which is why this writes the old shape rather
 * than today's: a workspace two shapes behind takes one hop at a time, and
 * each hop is a migration that can be run again.
 */
function writeDraftToFolder(root: string, draft: Record<string, unknown>) {
  const { id, words, ...record } = draft;
  if (typeof id !== "string") {
    return;
  }
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, PRIVATE_FOLDER_NAME), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "draft.md"),
    typeof words === "string" ? words : "",
  );
  writeJsonAtomic(
    path.join(dir, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
    record,
  );
}

/**
 * The files a beta draft names that it staged: each in an item folder of its
 * own, `<id>/<item>/<name>` under the drafts folder.
 */
function stagedFilesOf(
  root: string,
  draft: unknown,
): { itemDir: string; path: string }[] {
  if (
    !isObject(draft) ||
    typeof draft.id !== "string" ||
    !Array.isArray(draft.attached)
  ) {
    return [];
  }
  const draftDir = path.join(root, draft.id);
  return draft.attached.flatMap((item: unknown) => {
    if (!isObject(item) || typeof item.path !== "string") {
      return [];
    }
    const [itemName, ...rest] = path
      .relative(draftDir, item.path)
      .split(path.sep);
    return itemName === undefined ||
      itemName === "" ||
      itemName === ".." ||
      path.isAbsolute(itemName) ||
      rest.length === 0
      ? []
      : [{ itemDir: path.join(draftDir, itemName), path: item.path }];
  });
}

function removeIfEmpty(dir: string) {
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Not there, or not empty: either way it stays as it is.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Where a workspace's page pictures were kept before its machine data moved
 * out (`machine-data-migration.ts`), which is where the legacy take-in puts
 * them on their way.
 */
export function pageThumbnailsDirOf(workspacePath: string): string {
  return path.join(workspaceLayout(workspacePath).dataDir, "page-thumbnails");
}

/**
 * Where a workspace's stores were kept before its machine data moved out
 * (`machine-data-migration.ts`): the steps here bring them up to date there,
 * and that move then takes each to where it now lives.
 */
export function workspaceSettingsDirOf(workspacePath: string): string {
  return path.join(workspaceLayout(workspacePath).dataDir, "settings");
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

  writeIfAbsent(
    path.join(settingsDir, "preferences.json"),
    pick(readObject(legacyPreferencesPath), WORKSPACE_PREFERENCE_KEYS),
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
