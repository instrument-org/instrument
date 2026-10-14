import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import {
  entryExists,
  mergeEntrySync,
  moveEntrySync,
  recordMovedPaths,
  removeIfEmptySync,
  WORKSPACE_LAYOUT_VERSION,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { WORKSPACE_FORMAT_VERSION } from "./machine-data-migration";
import { pathWithin, samePath } from "./path-identity";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import {
  hasWorkspaceIdentity,
  openElsewhereBy,
  readRegistry,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  updateRegistry,
  workspaceMachineDirOf,
} from "./workspaces";

/**
 * Moving a workspace to a folder the person picked, from Settings, the
 * onboarding folder step or the dev RPC. Never at boot on its own, and never
 * with anything open: the pick is recorded in the workspace's registry entry
 * (`requestWorkspaceMove`), the app restarts, and the next launch makes the
 * move before any store opens (`finishPendingMove`).
 */

/** Why a folder cannot take the workspace. */
const MoveRefusalSchema = z.enum([
  /** Inside the app's own data, or holding it. */
  "app-data",
  /** The workspace's own folder, or one inside or around it. */
  "current",
  /** The home folder, or the top of a disk. */
  "home-or-drive",
  /** Not a folder that is there. */
  "missing",
  /** Not a whole path. */
  "not-absolute",
  /** Holds or sits inside another workspace this computer knows. */
  "other-workspace",
  /** This process is pinned to its workspace by `INSTRUMENT_WORKSPACE`. */
  "pinned",
  /** Holds a `.instrument` folder that is not a workspace's. */
  "taken",
  /** The workspace's layout sweeps have not finished in the app's data. */
  "unfinished",
  /** The app cannot write there. */
  "unwritable",
]);

type MoveRefusal = z.output<typeof MoveRefusalSchema>;

const OpenInsteadSchema = z.object({
  kind: z.literal("workspace"),
  name: z.string(),
});

const RefusedSchema = z.object({
  kind: z.literal("refused"),
  reason: MoveRefusalSchema,
});

/** A folder the workspace cannot move to: one to open instead, or one it cannot take, with why. */
export const NotMovableSchema = z.discriminatedUnion("kind", [
  OpenInsteadSchema,
  RefusedSchema,
]);

/**
 * What a picked folder is to the workspace: one it can move to, one that is
 * already a workspace (to open instead, never to move into), or one it
 * cannot take, with why.
 */
export const MoveVerdictSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("movable") }),
  OpenInsteadSchema,
  RefusedSchema,
]);

export type MoveVerdict = z.output<typeof MoveVerdictSchema>;

/**
 * What a file manager leaves in a folder it showed, which is no one's work:
 * removed rather than carried along, so the old folder empties.
 */
const FILE_MANAGER_RECORDS = new Set([".DS_Store", "desktop.ini", "Thumbs.db"]);

/**
 * Whether the workspace could move to `target`. A folder with other things
 * in it is fine (finished work in `~/Documents/Instrument`, say); one that
 * holds a workspace already is not a move, and the caller offers to open it.
 */
export function checkMoveTarget({
  target,
  userDataDir,
  workspace,
}: {
  target: string;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): MoveVerdict {
  const refused = (reason: MoveRefusal): MoveVerdict => ({
    kind: "refused",
    reason,
  });
  if (workspace.pinned) {
    return refused("pinned");
  }
  if (!path.isAbsolute(target)) {
    return refused("not-absolute");
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(target);
  } catch (error) {
    return refused(isDenied(error) ? "unwritable" : "missing");
  }
  if (!stats.isDirectory()) {
    return refused("missing");
  }
  if (samePath(target, workspace.path)) {
    return refused("current");
  }
  if (samePath(target, os.homedir()) || isVolumeRoot(target)) {
    return refused("home-or-drive");
  }
  if (pathWithin(target, userDataDir) || pathWithin(userDataDir, target)) {
    return refused("app-data");
  }
  if (
    pathWithin(target, workspace.path) ||
    pathWithin(workspace.path, target)
  ) {
    return refused("current");
  }
  if (
    readRegistry(userDataDir).workspaces.some(
      (entry) =>
        entry.id !== workspace.id &&
        (pathWithin(target, entry.path) || pathWithin(entry.path, target)),
    )
  ) {
    return refused("other-workspace");
  }
  if (entryExists(path.join(target, PRIVATE_FOLDER_NAME))) {
    return hasWorkspaceIdentity(target)
      ? { kind: "workspace", name: readWorkspaceIdentity(target).name }
      : refused("taken");
  }
  if (!canWrite(target)) {
    return refused("unwritable");
  }
  if (pathWithin(workspace.path, userDataDir) && !isSettled(workspace.path)) {
    return refused("unfinished");
  }
  return { kind: "movable" };
}

/**
 * Record the move for the next launch to make, from the folder the
 * workspace is in now. The caller restarts the app.
 */
export function requestWorkspaceMove({
  target,
  userDataDir,
  workspace,
}: {
  target: string;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): void {
  updateRegistry(userDataDir, (current) => ({
    ...current,
    workspaces: current.workspaces.map((entry) =>
      entry.id === workspace.id
        ? {
            ...entry,
            pendingMove: {
              from: entry.path,
              to: path.resolve(target),
            },
          }
        : entry,
    ),
  }));
}

/**
 * Make the move the registry entry records, before any store opens, and
 * answer the workspace where it now is.
 *
 * The order, each step safe to run again, so a launch cut short anywhere is
 * finished by the next and there is never a second live copy:
 *
 * 1. The records: `<from>/.instrument` is renamed into the target, or across
 *    volumes copied beside it, renamed into place once whole, and only then
 *    removed. Until step 2 the entry still names `<from>`, so that copy is
 *    the live one. Found in both places, the target's is a whole copy whose
 *    original was not yet removed, and nothing opened the original since (a
 *    launch that cannot make the move removes such a copy before it opens
 *    the original), so the original goes. A target holding another
 *    workspace's records stops the move and leaves everything where it was.
 * 2. The entry names the target: from here on that is the live copy.
 * 3. The rest of `<from>`'s top level, the person's own (the browser's
 *    download fallback), moves in beside the records where its name is
 *    free; a file manager's records go. `<from>` is removed once empty.
 * 4. `<from>` → target is recorded in `moved-paths.json`, so a path stored
 *    into the old folder is read back in the new one (`remapMovedPath`).
 * 5. On Windows the target's `.instrument` is made hidden.
 * 6. The pending move is cleared.
 *
 * Another live process holding the workspace (a second development
 * instance) postpones the move to a launch that finds it closed. Never
 * throws: a step that fails is reported and retried on the next launch.
 */
export function finishPendingMove({
  hide = hideAppFolder,
  userDataDir,
  workspace,
}: {
  hide?: (dataDir: string) => void;
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): { done: string[]; workspace: ResolvedWorkspace } {
  const done: string[] = [];
  const entry = readRegistry(userDataDir).workspaces.find(
    (candidate) => candidate.id === workspace.id,
  );
  const pending = entry?.pendingMove;
  if (!entry || !pending || workspace.pinned) {
    return { done, workspace };
  }
  const { from, to } = pending;
  const fromData = workspaceLayout(from).dataDir;
  const toData = workspaceLayout(to).dataDir;
  const machineDir = workspaceMachineDirOf(userDataDir, workspace.id);
  let at = workspace;
  try {
    if (!samePath(entry.path, to)) {
      const holder = openElsewhereBy(machineDir);
      if (holder !== null) {
        if (entryExists(fromData) && isOwnCopy(toData, entry.workspaceId)) {
          fs.rmSync(toData, { force: true, recursive: true });
        }
        done.push(
          `left the move to ${to} for a launch that finds process ${holder.toString()} gone`,
        );
        return { done, workspace };
      }
      // 1. The records.
      if (entryExists(toData)) {
        if (!isOwnCopy(toData, entry.workspaceId)) {
          clearPendingMove(userDataDir, workspace.id);
          done.push(
            `did not move to ${to}, which holds another workspace's records; left it where it was`,
          );
          return { done, workspace };
        }
        fs.rmSync(fromData, { force: true, recursive: true });
      } else if (entryExists(fromData)) {
        removePartialCopies(to);
        moveEntrySync(fromData, toData);
      } else {
        clearPendingMove(userDataDir, workspace.id);
        done.push(`found no records at ${fromData} to move to ${to}`);
        return { done, workspace };
      }
      done.push(`moved ${fromData} to ${toData}`);
      // 2. The entry names the target.
      updateRegistry(userDataDir, (current) => ({
        ...current,
        workspaces: current.workspaces.map((other) =>
          other.id === workspace.id ? { ...other, path: to } : other,
        ),
      }));
    }
    at = { ...workspace, path: to };
    // 3. The rest of the old folder.
    moveTheRest({ done, from, to });
    // 4. Stored paths read back where they went.
    recordMovedPaths(machineDir, [{ from, to }]);
    // 5. Hidden on Windows.
    hide(toData);
    // 6. Done.
    clearPendingMove(userDataDir, workspace.id);
  } catch (error) {
    done.push(
      `the move to ${to} stopped (${String(error)}); the next launch takes it up again`,
    );
  }
  return { done, workspace: at };
}

/**
 * Hide a workspace's `.instrument` on Windows, which hides a dot folder only
 * by its attribute. Spawned and left to finish: a folder left showing is
 * cosmetic. Nothing to do elsewhere, where the dot hides it.
 */
export function hideAppFolder(dataDir: string): void {
  if (process.platform !== "win32") {
    return;
  }
  try {
    const child = spawn("attrib", ["+h", dataDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      // No attrib: the folder stays visible.
    });
    child.unref();
  } catch {
    // The same.
  }
}

function clearPendingMove(userDataDir: string, id: string) {
  updateRegistry(userDataDir, (current) => ({
    ...current,
    workspaces: current.workspaces.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const { pendingMove: _cleared, ...rest } = entry;
      return rest;
    }),
  }));
}

/** Whether a copy of the records is this workspace's own, by its id. */
function isOwnCopy(dataDir: string, workspaceId: string | undefined) {
  return (
    workspaceId !== undefined &&
    readWorkspaceIdentity(path.dirname(dataDir)).id === workspaceId
  );
}

/**
 * Whether a folder can be written, by writing in it: a folder macOS keeps
 * from the app answers a mode check as writable and refuses the write.
 */
function canWrite(dir: string) {
  const probe = path.join(dir, `.instrument-write-check-${process.pid}`);
  try {
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isDenied(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
}

/**
 * Whether the workspace's migrations and layout sweeps have all finished,
 * which only a workspace in the app's own data runs: one that moved with
 * something left would leave it for good, since none of them runs on a
 * folder the person picked.
 */
function isSettled(workspacePath: string) {
  const identity = readWorkspaceIdentity(workspacePath);
  return (
    !hasWorkspaceIdentity(workspacePath) ||
    (identity.formatVersion >= WORKSPACE_FORMAT_VERSION &&
      identity.settingsVersion >= CURRENT_SETTINGS_VERSION &&
      identity.layoutVersion === WORKSPACE_LAYOUT_VERSION &&
      identity.legacyProjectsMigrated === true)
  );
}

/** The top of a disk: a folder on another device than the one holding it. */
function isVolumeRoot(dir: string) {
  const parent = path.dirname(dir);
  if (parent === dir) {
    return true;
  }
  try {
    return fs.statSync(dir).dev !== fs.statSync(parent).dev;
  } catch {
    return false;
  }
}

/**
 * Everything at the old folder's top level but its records, into the target
 * where each name is free, and the old folder removed once empty.
 */
function moveTheRest({
  done,
  from,
  to,
}: {
  done: string[];
  from: string;
  to: string;
}) {
  let names: string[];
  try {
    names = fs.readdirSync(from);
  } catch {
    return;
  }
  for (const name of names) {
    const entry = path.join(from, name);
    if (name === PRIVATE_FOLDER_NAME) {
      continue;
    }
    if (FILE_MANAGER_RECORDS.has(name)) {
      fs.rmSync(entry, { force: true });
      continue;
    }
    mergeEntrySync(entry, path.join(to, name), (left, taken) => {
      done.push(`left ${left}: ${taken} is already there`);
    });
  }
  removeIfEmptySync(from);
  if (!entryExists(from)) {
    done.push(`removed ${from}`);
  }
}

/** Copies a launch cut short left beside the target's records. */
function removePartialCopies(to: string) {
  let names: string[];
  try {
    names = fs.readdirSync(to);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(`${PRIVATE_FOLDER_NAME}.partial-`)) {
      fs.rmSync(path.join(to, name), { force: true, recursive: true });
    }
  }
}
