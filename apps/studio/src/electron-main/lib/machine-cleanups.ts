import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  BROWSER_FOLDER_NAMES,
  entryExists,
  moveEntrySync,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * What the move to visible folders leaves behind on this computer: a folder
 * per chat where one for the workspace does, files no build reads any more,
 * and a sign-in at the top of userData that belongs beside the workspace's
 * other keys.
 *
 * Runs at launch after the machine data move (`machine-data-migration.ts`)
 * and before any store opens, since one of the steps merges two stores into
 * one. Every step is a few stats when there is nothing to do, so each runs on
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
      "remove the browser homes kept per chat",
      (done) => {
        removePerChatBrowserHomes(where.machineDir, done);
      },
    ],
    [
      "show the workspace's .instrument again",
      (done) => {
        unhideAppFolder(where.workspace, done);
      },
    ],
    [
      "take in the Claude sign-in kept at the top of this computer's data",
      (done) => {
        takeInClaudeAccount(where, done);
      },
    ],
  ];
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
  if (!workspace.isDefault) {
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

/**
 * Takes the hidden attribute off a workspace's `.instrument` on Windows,
 * which an earlier build put there to hide a folder the dot does not hide
 * and which kept OneDrive from syncing it. A folder whose records a sync
 * engine skips is a folder the person's other computers cannot read the
 * chats from, which costs more than the folder showing in Explorer.
 *
 * Spawned and left to finish, as the hiding was: a folder that stays hidden
 * is cosmetic. The workspace records that it was done, so this spawns once
 * rather than on every launch; only Windows records it, so a folder that
 * reaches a Windows computer later is cleared there.
 */
function unhideAppFolder(workspace: ResolvedWorkspace, done: string[]) {
  if (process.platform !== "win32") {
    return;
  }
  const identity = readWorkspaceIdentity(workspace.path);
  if (identity.appFolderUnhidden) {
    return;
  }
  const dataDir = workspaceLayout(workspace.path).dataDir;
  if (entryExists(dataDir)) {
    const child = childProcess.spawn("attrib", ["-h", dataDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      // No attrib: the folder stays hidden, and nothing else changes.
    });
    child.unref();
  }
  writeWorkspaceIdentity(workspace.path, {
    ...identity,
    appFolderUnhidden: true,
  });
  done.push(`asked Windows to show ${dataDir} again`);
}

/**
 * The folder `agent-browser` ran with under `$HOME`, which was one per chat
 * and is now one for the workspace. Every copy held the same empty
 * `config.json` and the same provider plugin, both written again on each
 * invocation, so there is nothing in one to keep: the folders below the
 * shared home go, and what the shared home itself holds stays.
 */
function removePerChatBrowserHomes(machineDir: string, done: string[]) {
  const home = path.join(
    machineDir,
    WORKSPACE_MACHINE_ENTRIES.browser,
    BROWSER_FOLDER_NAMES.agentHome,
  );
  if (!entryExists(home)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    // No folder to read, or no reading it: the next boot tries again.
    return;
  }
  let removed = 0;
  for (const entry of entries) {
    // A link is not a copy this made, so it stays as it is.
    if (!entry.isDirectory()) {
      continue;
    }
    fs.rmSync(path.join(home, entry.name), { force: true, recursive: true });
    removed += 1;
  }
  if (removed > 0) {
    done.push(
      `removed ${removed.toString()} browser home${removed === 1 ? "" : "s"} kept per chat in ${home}`,
    );
  }
}
