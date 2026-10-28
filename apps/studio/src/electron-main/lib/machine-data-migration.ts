import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { entryExists, moveEntrySync } from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { FeatureNameSchema } from "@/shared/features";
import fs from "node:fs";
import path from "node:path";

import {
  pageThumbnailsDirOf,
  takeInUnfinished,
  workspaceSettingsDirOf,
} from "./settings-migration";
import {
  openElsewhereBy,
  readWorkspaceIdentity,
  readWorkspaceIdentityToChange,
  type ResolvedWorkspace,
  settleWorkspace,
  MACHINE_DATA_FORMAT_VERSION,
  workspaceMachineDirOf,
  writeJsonAtomic,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * Present in the machine folder while a move runs, removed once every entry
 * moved, so a boot that finds it knows the last move stopped partway.
 */
const UNFINISHED_MARKER = ".move-unfinished";

/**
 * The secret stores, by both their names: dev builds write plaintext, packaged
 * builds safeStorage ciphertext. With them the record of which apps are
 * connected, which means nothing without their credentials.
 */
const KEY_FILES = [
  "app-connections.json",
  "app-credentials.json",
  "app-credentials.json.enc",
  "app-oauth.json",
  "app-oauth.json.enc",
  "chatgpt-account.json",
  "chatgpt-account.json.enc",
  "providers.json",
  "providers.json.enc",
  "session-dev.json",
  "session.json.enc",
];

/** The stores that follow the person, from the settings folder to the top of `.instrument/`. */
const TRAVELING_FILES = ["bookmarks.json"];

/** The window's stores: its size and place, where the person left off, how they lay things out. */
const WINDOW_FILES = ["layout.json", "view.json", "window-state.json"];

/** The in-app browser's list of downloads, which names this computer's files. */
const BROWSER_FILES = ["downloads.json"];

/** Where every workspace's index was kept before each had a machine folder. */
const LEGACY_INDEXES_DIR = "indexes";

/** A SQLite file and the files beside it that must travel with it. */
const SQLITE_FILES = ["", "-journal", "-shm", "-wal"];

/**
 * Takes what is this computer's own out of the resolved workspace folder and
 * into its machine folder, `<userData>/machine/<local id>/`: secrets
 * encrypted with this computer's key, the Chromium profiles and browser
 * history, the window's state, the folder rules (whose paths are this
 * computer's), installed app servers, and the person's preferences with the
 * experimental flags merged into them. What follows the person stays and
 * moves up out of `.instrument/settings/`, and the layout sweep's marker
 * files become fields of `workspace.json`.
 *
 * Runs after `settings-migration.ts`, before any store opens, once per
 * workspace: `formatVersion` in `workspace.json` says it is done. Only a
 * workspace an earlier build made is ever below it: the settings migration
 * takes a folder no build made a workspace of in at this format, since what
 * is at its top level (a `permissions.json`, an `.app-servers` folder) is the
 * person's own. Each entry
 * is renamed (copied, then removed, across volumes) only where its new place
 * is empty, so nothing is ever made again in place of what it moves, and an
 * entry that cannot be moved stays where it was and is retried on the next
 * boot. Never throws: the returned machine folder is where the stores open
 * either way. A move that stopped partway leaves the stores to open at the
 * new places and write their defaults there, so the retry puts what is still
 * at an old place over them, as the settings take-in does.
 */
export function moveMachineData({
  userDataDir,
  workspace,
}: {
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): { done: string[]; machineDir: string } {
  const done: string[] = [];
  let machineDir = workspaceMachineDirOf(userDataDir, workspace.id);
  try {
    machineDir = settleWorkspace({ userDataDir, workspace });
  } catch (error) {
    // The folder is named by the local id either way; what failed is
    // recording whose it is, which the next boot does.
    done.push(`could not settle the workspace's id: ${String(error)}`);
  }

  try {
    const marker = path.join(machineDir, UNFINISHED_MARKER);
    // The format alone does not say this finished. A move that failed leaves
    // the format where it was and this marker behind, for the next launch to
    // pick up; the chat conversion that runs later in the same launch then
    // raises the format past this one whether or not the move finished, so
    // without the marker a workspace whose credentials or profiles were
    // left behind would never try again.
    if (
      readWorkspaceIdentity(workspace.path).formatVersion >=
        MACHINE_DATA_FORMAT_VERSION &&
      !fs.existsSync(marker)
    ) {
      removeTakenInRootKeys({ done, machineDir, userDataDir, workspace });
      removeLegacyIndexes({ done, userDataDir });
      return { done, machineDir };
    }
    const overwrite = fs.existsSync(marker);
    writeJsonAtomic(marker, { pid: process.pid });
    // An older build still running on this workspace has its stores and
    // profiles open where they are, and moving them from under it would split
    // each in two. They move on a boot that finds it gone, and the marker
    // has that move put them over whatever this one writes in the meantime.
    const holder = openElsewhereBy(workspaceLayout(workspace.path).dataDir);
    if (holder !== null) {
      done.push(
        `left the machine data where it is while process ${holder.toString()} has the workspace open`,
      );
      return { done, machineDir };
    }
    // What a take-in that stopped partway left in the settings folder is
    // half of what it brings in. Moved now, the rest would land there on
    // the take-in's retry after this move had finished, where nothing reads
    // it; left, it moves with the rest once the take-in finishes, over what
    // the stores write in the meantime.
    if (takeInUnfinished(workspace.path)) {
      done.push(
        "left the machine data where it is until the settings take-in finishes",
      );
      return { done, machineDir };
    }

    let failed = 0;
    for (const [from, to] of plannedMoves({
      machineDir,
      workspacePath: workspace.path,
    })) {
      try {
        moveEntry({
          done,
          from,
          overwrite,
          to,
          workspacePath: workspace.path,
        });
      } catch (error) {
        failed++;
        done.push(`could not move ${from} (${String(error)}); left it there`);
      }
    }
    // Once the preferences are in place, so a retry that puts them over the
    // defaults does not drop the flags merged into those.
    if (failed === 0) {
      try {
        mergeFeaturesIntoPreferences({
          done,
          machineDir,
          workspacePath: workspace.path,
        });
      } catch (error) {
        failed++;
        done.push(`could not merge the feature flags (${String(error)})`);
      }
    }
    foldLayoutMarkers(workspace.path, done);
    removeLeftovers({ done, workspacePath: workspace.path });

    if (failed === 0) {
      const identity = readWorkspaceIdentityToChange(workspace.path);
      writeWorkspaceIdentity(workspace.path, {
        ...identity,
        // Never backwards: a move that finishes on a later launch runs after
        // the chat conversion has raised the format past this one, and
        // putting it back would offer the workspace to a build that cannot
        // read it.
        formatVersion: Math.max(
          identity.formatVersion,
          MACHINE_DATA_FORMAT_VERSION,
        ),
      });
      fs.rmSync(marker, { force: true });
      done.push(
        `workspace at format version ${MACHINE_DATA_FORMAT_VERSION.toString()}, machine data in ${machineDir}`,
      );
      removeTakenInRootKeys({ done, machineDir, userDataDir, workspace });
      removeLegacyIndexes({ done, userDataDir });
    }
  } catch (error) {
    done.push(`machine data move stopped: ${String(error)}`);
  }
  return { done, machineDir };
}

/**
 * `.layout-version` and `.legacy-projects-migrated`, which the layout sweep
 * left in `.instrument/`, as the fields it now keeps in `workspace.json`
 * (`workspaceLayoutMarks`). Written before the files go, so a crash between
 * the two leaves both rather than neither.
 */
function foldLayoutMarkers(workspacePath: string, done: string[]) {
  const dataDir = workspaceLayout(workspacePath).dataDir;
  const versionFile = path.join(dataDir, ".layout-version");
  const projectsFile = path.join(dataDir, ".legacy-projects-migrated");
  const change: { layoutVersion?: number; legacyProjectsMigrated?: true } = {};
  try {
    const version = Number(fs.readFileSync(versionFile, "utf8").trim());
    if (Number.isInteger(version) && version >= 0) {
      change.layoutVersion = version;
    }
  } catch {
    // No sweep finished yet, or a file it cut short: the next one says.
  }
  if (fs.existsSync(projectsFile)) {
    change.legacyProjectsMigrated = true;
  }
  if (Object.keys(change).length > 0) {
    writeWorkspaceIdentity(workspacePath, {
      ...readWorkspaceIdentityToChange(workspacePath),
      ...change,
    });
    done.push("folded the layout markers into workspace.json");
  }
  fs.rmSync(versionFile, { force: true });
  fs.rmSync(projectsFile, { force: true });
}

/**
 * Move `from` to `to` where `to` is free. With `overwrite`, `from` replaces
 * what is at `to`: the stores' defaults, written there after an earlier move
 * stopped partway. Without it, an entry already at `to` is kept and `from`
 * left where it is. A link stays where it is, as does anything in a folder
 * that is one.
 */
function moveEntry({
  done,
  from,
  overwrite,
  to,
  workspacePath,
}: {
  done: string[];
  from: string;
  overwrite: boolean;
  to: string;
  workspacePath: string;
}) {
  if (!entryExists(from)) {
    return;
  }
  // A link, or an entry in a folder that is one, is not the workspace's to
  // take into this computer's data: it stays where it is. The workspace's
  // own folder may be reached through a link the person made.
  const holder = path.dirname(from);
  if (isLink(from) || (holder !== workspacePath && isLink(holder))) {
    done.push(`left ${from}: it is a link, or in one`);
    return;
  }
  if (entryExists(to)) {
    if (!overwrite) {
      done.push(`left ${from}: ${to} is already there`);
      return;
    }
    fs.rmSync(to, { force: true, recursive: true });
  }
  moveEntrySync(from, to);
  done.push(`moved ${from} to ${to}`);
}

/** Every entry that moves, from where it was to where it goes. */
function plannedMoves({
  machineDir,
  workspacePath,
}: {
  machineDir: string;
  workspacePath: string;
}): [from: string, to: string][] {
  const dataDir = workspaceLayout(workspacePath).dataDir;
  const settingsDir = workspaceSettingsDirOf(workspacePath);
  const keysDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys);
  const browserDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.browser);
  const windowDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.window);
  // Any other encrypted store goes with the keys: whatever it is, it was
  // encrypted with this computer's key.
  const keyFiles = new Set(KEY_FILES);
  try {
    for (const name of fs.readdirSync(settingsDir)) {
      if (name.endsWith(".enc")) {
        keyFiles.add(name);
      }
    }
  } catch {
    // No settings folder: nothing to move out of it.
  }
  const into = (from: string, toDir: string, names: Iterable<string>) =>
    [...names].map((name): [string, string] => [
      path.join(from, name),
      path.join(toDir, name),
    ]);
  return [
    ...into(settingsDir, keysDir, keyFiles),
    [
      path.join(settingsDir, "state.json"),
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.state),
    ],
    ...into(settingsDir, browserDir, BROWSER_FILES),
    ...into(dataDir, browserDir, ["app-session", "browser-session"]),
    ...into(
      dataDir,
      browserDir,
      SQLITE_FILES.map((suffix) => `history.db${suffix}`),
    ),
    [
      pageThumbnailsDirOf(workspacePath),
      path.join(browserDir, "page-thumbnails"),
    ],
    ...into(settingsDir, windowDir, WINDOW_FILES),
    [
      path.join(workspacePath, "permissions.json"),
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.permissions),
    ],
    [
      path.join(workspacePath, ".app-servers"),
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.appServers),
    ],
    [
      path.join(settingsDir, "preferences.json"),
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.preferences),
    ],
    ...into(settingsDir, dataDir, TRAVELING_FILES),
  ];
}

/**
 * The experimental flags, out of the settings folder's `features.json` and
 * into the `features` of the preferences in this computer's folder, beside
 * the rest of what the person chose for the workspace on this computer.
 *
 * A flag the file holds wins over one already under `features`; a flag this
 * build does not know is dropped, as the flags' own store dropped it. The
 * file goes once the merged preferences are written, or at once when it
 * cannot be read: the flags' own store wrote its defaults over one it could
 * not parse, so it held nothing worth keeping.
 */
function mergeFeaturesIntoPreferences({
  done,
  machineDir,
  workspacePath,
}: {
  done: string[];
  machineDir: string;
  workspacePath: string;
}) {
  const file = path.join(
    workspaceSettingsDirOf(workspacePath),
    "features.json",
  );
  if (!entryExists(file)) {
    return;
  }
  const stored = readJsonObject(file);
  if (!stored) {
    fs.rmSync(file, { force: true });
    return;
  }
  const flags = Object.fromEntries(
    Object.entries(stored).flatMap(([name, value]) =>
      FeatureNameSchema.safeParse(name).success && typeof value === "boolean"
        ? [[name, value]]
        : [],
    ),
  );
  const preferencesFile = path.join(
    machineDir,
    WORKSPACE_MACHINE_ENTRIES.preferences,
  );
  const preferences = readJsonObject(preferencesFile) ?? {};
  const features = preferences.features;
  writeJsonAtomic(preferencesFile, {
    ...preferences,
    features: {
      ...(isJsonObject(features) ? features : {}),
      ...flags,
    },
  });
  fs.rmSync(file, { force: true });
  done.push(
    `merged ${Object.keys(flags).length.toString()} feature flag${Object.keys(flags).length === 1 ? "" : "s"} into ${preferencesFile}`,
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    // Not there, or not a file the app wrote: nothing to take from it.
    return undefined;
  }
}

/**
 * The default workspace's key stores still at the root of userData, from
 * before workspaces: the settings take-in copied them into the workspace and
 * only a packaged build then removed them, so a development build's are there
 * in plaintext. Once the workspace has all of its machine data in place, each
 * goes when its keys hold the same store and the root copy is no newer than
 * theirs, which is what the take-in left. A root copy written after that (by
 * an older build sharing this userData) or one the keys do not hold is the
 * only copy of what it says, and stays. On every boot rather than once, since
 * it costs a few stats and a workspace moved by an earlier build still has
 * them.
 */
function removeTakenInRootKeys({
  done,
  machineDir,
  userDataDir,
  workspace,
}: {
  done: string[];
  machineDir: string;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}) {
  if (!workspace.isDefault) {
    return;
  }
  const keysDir = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys);
  for (const name of KEY_FILES) {
    const rootCopy = path.join(userDataDir, name);
    const atRoot = fileStats(rootCopy);
    const kept = fileStats(path.join(keysDir, name));
    if (atRoot && kept && atRoot.mtimeMs <= kept.mtimeMs) {
      fs.rmSync(rootCopy, { force: true });
      done.push(`removed the root copy of ${name}, which the keys hold`);
    }
  }
}

/**
 * The folder every workspace's index was kept in before each had a machine
 * folder. An index is rebuilt from the workspace's chats in its machine
 * folder's `workspace.db`, so nothing reads one from here. On every boot, like
 * the root key copies, so a folder an earlier build left goes.
 */
function removeLegacyIndexes({
  done,
  userDataDir,
}: {
  done: string[];
  userDataDir: string;
}) {
  const dir = path.join(userDataDir, LEGACY_INDEXES_DIR);
  if (!entryExists(dir)) {
    return;
  }
  fs.rmSync(dir, { force: true, recursive: true });
  done.push(`removed ${dir}, which held indexes nothing reads`);
}

function isLink(entry: string) {
  try {
    return fs.lstatSync(entry).isSymbolicLink();
  } catch {
    return false;
  }
}

function fileStats(file: string): fs.Stats | undefined {
  try {
    const stats = fs.statSync(file);
    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What nothing reads any more: `window.json`, retired with what it held; the
 * open mark, now kept on this computer's side, which no live process holds by
 * the time this runs; and the settings folder the moves emptied.
 */
function removeLeftovers({
  done,
  workspacePath,
}: {
  done: string[];
  workspacePath: string;
}) {
  const dataDir = workspaceLayout(workspacePath).dataDir;
  if (entryExists(path.join(dataDir, "window.json"))) {
    fs.rmSync(path.join(dataDir, "window.json"), { force: true });
    done.push("removed window.json, which nothing reads");
  }
  fs.rmSync(path.join(dataDir, WORKSPACE_MACHINE_ENTRIES.openMark), {
    force: true,
  });
  try {
    fs.rmdirSync(workspaceSettingsDirOf(workspacePath));
  } catch {
    // Not empty, or not there: either way it stays as it is.
  }
}
