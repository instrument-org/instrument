import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  BROWSER_FOLDER_NAMES,
  entryExists,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import path from "node:path";

import { type ResolvedWorkspace } from "./workspaces";

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
  ];
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
