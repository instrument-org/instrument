import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import {
  ASIDE_INFIX,
  asidesOf,
  entryExists,
  isDirectorySync,
  mergeEntrySync,
  PARTIAL_INFIX,
  placeEntrySync,
  recordMovedPaths,
  removeEntrySync,
  removeIfEmptySync,
  setAsideSync,
  WORKSPACE_LAYOUT_VERSION,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
 * What the copy a move makes across volumes carries in its `.instrument`,
 * holding the move's `copyMark`, until the entry names the target.
 */
const COPY_MARK_FILE = "move-copy-mark";

/**
 * Make the move the registry entry records, before any store opens, and
 * answer the workspace where it now is.
 *
 * The order is what keeps the records safe from a launch cut short (a
 * crash, a forced quit) or a step that fails: at every point exactly one
 * copy of the records is the live one, a launch opens only that one, and
 * nothing a launch may open is ever deleted. Each step is safe to run
 * again, so the next launch finishes what one left.
 *
 * 1. A whole copy at the target. On one volume, `<from>/.instrument` is
 *    renamed to the target in a single step. Across volumes it is copied
 *    beside the target (`.instrument.partial-<pid>`), marked with the
 *    `copyMark` the entry records first, and renamed into place once whole;
 *    a launch cut short leaves only the partial copy, which the next one
 *    removes and makes again. From here on the target's copy is the live
 *    one, and the original is never opened again, by this launch or any
 *    other, even when a later step fails.
 * 2. The entry names the target.
 * 3. The original, still in `<from>` after a copy, is renamed aside there
 *    (`.instrument.moved-<pid>-<time>`), a rename on its own volume, so no
 *    launch and no folder pick finds records in `<from>` again.
 * 4. The rest of `<from>`'s top level, the person's own (the browser's
 *    download fallback), moves in beside the records where its name is
 *    free; a file manager's records go.
 * 5. `<from>` → target is recorded in `moved-paths.json`, so a path stored
 *    into the old folder is read back in the new one (`remapMovedPath`).
 * 6. On Windows the target's `.instrument` is made hidden.
 * 7. Last, the original set aside is deleted, and `<from>` removed once
 *    empty. A delete that fails part-way (a file another program holds
 *    open on Windows, a locked file) costs nothing, since nothing opens the
 *    aside: the pending move is kept with only this step left
 *    (`leftAside`), and each later launch tries it again.
 * 8. The pending move is cleared.
 *
 * A `.instrument` found at the target before step 1 is this move's own
 * copy only when it carries the move's mark, or when the original is gone
 * (a launch cut short between a same-volume rename and step 2). Anything
 * else there, another workspace's records or a link, stops the move and
 * leaves everything where it was. Another live process holding the
 * workspace (a second development instance) postpones the steps left to a
 * launch that finds it closed, and this launch opens the live copy. Never
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
  const moved = { ...workspace, path: to };
  let at = samePath(entry.path, to) ? moved : workspace;
  try {
    if (!pending.leftAside) {
      if (!samePath(entry.path, to)) {
        const placed =
          isPlacedCopy(toData, pending.copyMark) ||
          (!entryExists(fromData) && isRecordsOf(toData, entry.workspaceId));
        const holder = openElsewhereBy(machineDir);
        if (holder !== null) {
          done.push(
            `left the move to ${to} for a launch that finds process ${holder.toString()} gone`,
          );
          return { done, workspace: placed ? moved : workspace };
        }
        // 1. A whole copy at the target.
        if (placed) {
          done.push(
            `found the whole copy at ${toData} a launch cut short made`,
          );
        } else {
          if (entryExists(toData)) {
            clearPendingMove(userDataDir, workspace.id);
            done.push(
              `did not move to ${to}, which holds a ${PRIVATE_FOLDER_NAME} this move did not put there; left everything where it was`,
            );
            return { done, workspace };
          }
          if (!entryExists(fromData)) {
            clearPendingMove(userDataDir, workspace.id);
            done.push(`found no records at ${fromData} to move to ${to}`);
            return { done, workspace };
          }
          removePartialCopies(toData);
          const how = placeEntrySync(fromData, toData, (copy) => {
            const copyMark = randomUUID();
            updatePendingMove(userDataDir, workspace.id, { copyMark });
            fs.writeFileSync(path.join(copy, COPY_MARK_FILE), copyMark);
          });
          done.push(
            `${how === "renamed" ? "moved" : "copied"} ${fromData} to ${toData}`,
          );
        }
        at = moved;
        // 2. The entry names the target.
        updateRegistry(userDataDir, (current) => ({
          ...current,
          workspaces: current.workspaces.map((other) =>
            other.id === workspace.id ? { ...other, path: to } : other,
          ),
        }));
        fs.rmSync(path.join(toData, COPY_MARK_FILE), { force: true });
      }
      // 3. The original aside.
      if (entryExists(fromData)) {
        if (isRecordsOf(fromData, entry.workspaceId)) {
          setAsideSync(fromData);
        } else {
          done.push(
            `left ${fromData}, which is not this workspace's records any more`,
          );
        }
      }
      // 4. The rest of the old folder.
      moveTheRest({ done, from, to });
      // 5. Stored paths read back where they went.
      recordMovedPaths(machineDir, [{ from, to }]);
      // 6. Hidden on Windows.
      hide(toData);
    }
    // 7. The original's records deleted, and the old folder once empty.
    const left = asidesOf(fromData).filter((aside) => {
      try {
        removeEntrySync(aside);
        return false;
      } catch (error) {
        done.push(
          `could not delete ${aside} (${String(error)}); the next launch tries again`,
        );
        return true;
      }
    });
    if (left.length > 0) {
      updatePendingMove(userDataDir, workspace.id, { leftAside: true });
      return { done, workspace: at };
    }
    removeIfEmptySync(from);
    if (!entryExists(from)) {
      done.push(`removed ${from}`);
    }
    // 8. Done.
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

/** Change the pending move the registry entry `id` records, where it still has one. */
function updatePendingMove(
  userDataDir: string,
  id: string,
  change: { copyMark?: string; leftAside?: true },
) {
  updateRegistry(userDataDir, (current) => ({
    ...current,
    workspaces: current.workspaces.map((entry) =>
      entry.id === id && entry.pendingMove
        ? { ...entry, pendingMove: { ...entry.pendingMove, ...change } }
        : entry,
    ),
  }));
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

/**
 * Whether a `.instrument` is a folder (never a link) holding this
 * workspace's records, by its id where the entry has one.
 */
function isRecordsOf(dataDir: string, workspaceId: string | undefined) {
  const workspacePath = path.dirname(dataDir);
  return (
    isDirectorySync(dataDir) &&
    hasWorkspaceIdentity(workspacePath) &&
    (workspaceId === undefined ||
      readWorkspaceIdentity(workspacePath).id === workspaceId)
  );
}

/** Whether a `.instrument` is a folder (never a link) holding the copy a move marked. */
function isPlacedCopy(dataDir: string, copyMark: string | undefined) {
  if (copyMark === undefined || !isDirectorySync(dataDir)) {
    return false;
  }
  try {
    return (
      fs.readFileSync(path.join(dataDir, COPY_MARK_FILE), "utf8").trim() ===
      copyMark
    );
  } catch {
    return false;
  }
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
 * Everything at the old folder's top level but its records and their aside,
 * into the target where each name is free.
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
    if (
      name === PRIVATE_FOLDER_NAME ||
      name.startsWith(`${PRIVATE_FOLDER_NAME}${ASIDE_INFIX}`)
    ) {
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
}

/** Copies a launch cut short left beside the target's records. */
function removePartialCopies(toData: string) {
  let names: string[];
  try {
    names = fs.readdirSync(path.dirname(toData));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(`${path.basename(toData)}${PARTIAL_INFIX}`)) {
      removeEntrySync(path.join(path.dirname(toData), name));
    }
  }
}
