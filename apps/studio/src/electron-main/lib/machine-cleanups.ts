import {
  APP_NAME_SLUG,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import {
  CHAT_FOLDER_NAMES,
  entryExists,
  moveEntrySync,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

import { pathWithin } from "./path-identity";
import {
  CURRENT_SETTINGS_VERSION,
  MACHINE_PREFERENCES_NAME,
  MACHINE_STATE_NAME,
} from "./settings-migration";
import {
  MACHINE_DATA_FORMAT_VERSION,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
} from "./workspaces";

/**
 * The root settings 1.x and the 2.0 betas wrote, each replaced by a store
 * the workspace or this computer keeps: the person's choices and where they
 * left off, the experimental flags, the window's size and place, and the
 * pinned tasks under the name that feature had before it was pinning.
 */
const LEGACY_ROOT_SETTINGS = [
  "app-state.json",
  "favorites.json",
  "features.json",
  "preferences.json",
  "window-state.json",
];

/** The ChatGPT plan record, by both its names, which nothing reads. */
const LEGACY_CHATGPT_PLAN_FILES = [
  "chatgpt-plan.json",
  "chatgpt-plan.json.enc",
];

/**
 * What the move to visible folders leaves behind on this computer: files no
 * build reads any more, the browser's own downloads folder, and a sign-in at
 * the top of userData that belongs beside the workspace's other keys.
 *
 * Runs at launch after the machine data move (`machine-data-migration.ts`)
 * and before any store opens. Every step is a few stats when there is nothing to do, so each runs on
 * every boot rather than once; nothing here throws, and a step that fails
 * leaves what it was clearing for the next boot.
 */
export function cleanUpMachineData({
  machineDir,
  userDataDir,
  workspace,
}: {
  /** The workspace's folder on this computer, as the data move settled it. */
  machineDir: string;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): string[] {
  const done: string[] = [];
  for (const [what, step] of steps({ machineDir, userDataDir, workspace })) {
    try {
      step(done);
    } catch (error) {
      done.push(`could not ${what}: ${String(error)}`);
    }
  }
  return done;
}

function steps(where: {
  machineDir: string;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): [what: string, step: (done: string[]) => void][] {
  return [
    [
      "take in the Claude sign-in kept at the top of this computer's data",
      (done) => {
        takeInClaudeAccount(where, done);
      },
    ],
    [
      "remove the browser's own downloads folder",
      (done) => {
        removeDownloadsFallback(where, done);
      },
    ],
    [
      "remove the files no build reads any more",
      (done) => {
        removeDeadFiles(where, done);
      },
    ],
  ];
}

/**
 * The files 1.x and the 2.0 betas left that nothing reads: the root settings
 * every workspace store has replaced, the ChatGPT plan the account record
 * replaced, the 1.2 beta's own `workspace.db` and `migrations.json` in the
 * workspace, and an install script a Linux update left behind.
 *
 * The root settings go only once the default workspace has taken them in
 * and finished both of its migrations, since those two read them; another
 * workspace never read them and leaves them alone. A file a later build put
 * back is removed again on the next boot, which is why this is a few stats
 * on every boot rather than one pass.
 */
function removeDeadFiles(
  {
    machineDir,
    userDataDir,
    workspace,
  }: {
    machineDir: string;
    userDataDir: string;
    workspace: ResolvedWorkspace;
  },
  done: string[],
) {
  const dataDir = workspaceLayout(workspace.path).dataDir;
  const dead = [
    // The ChatGPT sign-in under the name it had before it was the ChatGPT
    // account: a token nothing reads, at the root and in the keys the
    // machine data move carried it to.
    ...LEGACY_CHATGPT_PLAN_FILES.flatMap((name) => [
      path.join(userDataDir, name),
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.keys, name),
    ]),
    // The key-value store the 1.2 beta kept the pinned tasks in, and the
    // register of finished migrations that `workspace.json` now holds.
    path.join(dataDir, "workspace.db"),
    path.join(dataDir, "migrations.json"),
    ...(workspace.isDefault && rootSettingsTakenIn({ userDataDir, workspace })
      ? LEGACY_ROOT_SETTINGS.map((name) => path.join(userDataDir, name))
      : []),
    ...staleInstallScripts(userDataDir),
  ];
  const removed = dead.filter((file) => {
    if (!fileStats(file)) {
      return false;
    }
    fs.rmSync(file, { force: true });
    return true;
  });
  if (removed.length > 0) {
    done.push(`removed ${removed.length.toString()} file(s) nothing reads`);
  }
}

/**
 * Whether the root settings have been read for the last time: the default
 * workspace holds what both migrations took from them, and this computer's
 * own half of them is written. Until then they are the only copy of a
 * choice the person made.
 */
function rootSettingsTakenIn({
  userDataDir,
  workspace,
}: {
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): boolean {
  const identity = readWorkspaceIdentity(workspace.path);
  return (
    identity.settingsVersion >= CURRENT_SETTINGS_VERSION &&
    identity.formatVersion >= MACHINE_DATA_FORMAT_VERSION &&
    [MACHINE_PREFERENCES_NAME, MACHINE_STATE_NAME].every((name) =>
      fileStats(path.join(userDataDir, `${name}.json`)),
    )
  );
}

/**
 * The scripts a Linux update wrote to hand the install to `dpkg`. Each
 * removes itself when it finishes, so one still here is from an update that
 * never ran or was cut short, and it holds a command line meant for
 * `pkexec`.
 */
function staleInstallScripts(userDataDir: string): string[] {
  try {
    return fs
      .readdirSync(userDataDir)
      .filter(
        (name) =>
          name.startsWith(`${APP_NAME_SLUG}-install-`) && name.endsWith(".sh"),
      )
      .map((name) => path.join(userDataDir, name));
  } catch {
    return [];
  }
}

function fileStats(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The `downloads` folder the in-app browser kept at the top of the
 * Instrument folder when the person's own Downloads took no file. The person
 * is asked where to put such a file now, so nothing writes here again.
 *
 * Removed only while it is empty. Anything in it is a file the person
 * downloaded, which is theirs: the folder stays with those files in it, and
 * goes on the launch after they have moved or deleted the last one.
 *
 * Only in a workspace in the app's own data, where the browser made it. In a
 * picked folder the top level is the person's, and on a disk that ignores
 * case their own `Downloads` answers to the name.
 */
function removeDownloadsFallback(
  {
    userDataDir,
    workspace,
  }: { userDataDir: string; workspace: ResolvedWorkspace },
  done: string[],
) {
  if (!pathWithin(workspace.path, userDataDir)) {
    return;
  }
  const dir = path.join(workspace.path, CHAT_FOLDER_NAMES.downloads);
  try {
    if (fs.readdirSync(dir).length > 0) {
      return;
    }
  } catch {
    // Not there, or no reading it: nothing to remove either way.
    return;
  }
  fs.rmdirSync(dir);
  done.push(`removed ${dir}, which the browser no longer saves into`);
}

/**
 * The config folder our copy of Claude Code runs with, from the top of
 * userData into the workspace's folder on this computer, beside its other
 * keys. It is a sign-in, and every other sign-in is the workspace's.
 *
 * Only the default workspace takes it in: the folder predates every other
 * one, as the root key stores do (`removeTakenInRootKeys`). Moved only where
 * nothing is at the new place, so a workspace already signed in keeps the
 * account it has and the root folder stays for whoever wants it.
 */
function takeInClaudeAccount(
  {
    machineDir,
    userDataDir,
    workspace,
  }: {
    machineDir: string;
    userDataDir: string;
    workspace: ResolvedWorkspace;
  },
  done: string[],
) {
  // Only the default workspace in the app's own data takes in what predates
  // workspaces.
  if (!workspace.isDefault || !pathWithin(workspace.path, userDataDir)) {
    return;
  }
  const from = path.join(userDataDir, WORKSPACE_MACHINE_ENTRIES.claudeAccount);
  const to = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.claudeAccount);
  if (!entryExists(from) || entryExists(to)) {
    return;
  }
  fs.mkdirSync(machineDir, { recursive: true });
  moveEntrySync(from, to);
  done.push(`moved the Claude sign-in from ${from} to ${to}`);
}
