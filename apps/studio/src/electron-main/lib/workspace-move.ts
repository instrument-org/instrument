import {
  PRIVATE_FOLDER_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import {
  ASIDE_INFIX,
  asidesOf,
  entryExists,
  isDirectorySync,
  mergeEntrySync,
  placeEntrySync,
  placePaths,
  rewriteStoredPaths,
  removeEntrySync,
  removeIfEmptySync,
  setAsideSync,
  WORKSPACE_LAYOUT_VERSION,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  FolderRefusalSchema,
  type FolderWarning,
  FolderWarningSchema,
} from "../../shared/workspace-folder-refusal";
import { pathWithin, samePath } from "./path-identity";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import {
  folderConcernHere,
  systemTemporaryDirs,
} from "./workspace-folder-check";
import {
  hasWorkspaceIdentity,
  liveHolderOf,
  markWorkspaceOpen,
  openElsewhereBy,
  readRegistry,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  updateRegistry,
  workspaceMachineDirOf,
  type WorkspaceRegistry,
  MACHINE_DATA_FORMAT_VERSION,
  WORKSPACE_FORMAT_VERSION,
} from "./workspaces";

/**
 * Moving a workspace to a folder the person picked, from Settings, the
 * setup folder step or the dev RPC. Never at boot on its own, and never
 * with anything open: the pick is recorded in the workspace's registry entry
 * (`requestWorkspaceMove`), the app restarts, and the next launch makes the
 * move before any store opens (`finishPendingMove`).
 */

/** Why a folder cannot take the workspace: anywhere a workspace can't be (`folderConcern`), or a reason of moving's own. */
const MoveRefusalSchema = z.enum([
  ...FolderRefusalSchema.options,
  /**
   * A folder that holds the workspace's own folder, where the folder offered
   * instead is not that one.
   */
  "around",
  /**
   * The workspace's own folder, or one around it whose folder offered
   * instead is the workspace's own: where the workspace already is.
   */
  "current",
  /** A folder inside the workspace's own folder. */
  "inside",
  /** Not a folder that is there. */
  "missing",
  /** Holds a workspace a newer build made, which this one can't open. */
  "newer",
  /** Not a whole path. */
  "not-absolute",
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

/** What the person is warned of before they go ahead (`folderConcern`). */
const WarningField = {
  warning: FolderWarningSchema.optional(),
};

const OpenInsteadSchema = z.object({
  kind: z.literal("workspace"),
  name: z.string(),
  ...WarningField,
});

const RefusedSchema = z.object({
  kind: z.literal("refused"),
  reason: MoveRefusalSchema,
  ...WarningField,
});

/** A folder the workspace cannot move to: one to open instead, or one it cannot take, with why. */
export const NotMovableSchema = z.discriminatedUnion("kind", [
  OpenInsteadSchema,
  RefusedSchema,
]);

/**
 * What a picked folder is to the workspace: one it can move to, one that is
 * already a workspace (to open instead, never to move into), or one it
 * cannot take, with why. The first two carry what the person is warned of
 * about the place, if anything.
 */
export const MoveVerdictSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("movable"), ...WarningField }),
  OpenInsteadSchema,
  RefusedSchema,
]);

export type MoveVerdict = z.output<typeof MoveVerdictSchema>;

/** A folder the Instrument folder could be, what is in it already, and what it would be to the workspace. */
const DestinationSchema = z.object({
  /** Not there yet (`new`), there with nothing in it, or there with other files. */
  contents: z.enum(["new", "empty", "files"]),
  path: z.string(),
  verdict: MoveVerdictSchema,
});

/**
 * Where a folder the person picked puts their Instrument folder
 * (`checkFolderPick`): the folder it would be, and the pick itself where
 * using it as it is is a choice to ask about.
 */
export const FolderPickSchema = z.object({
  folder: DestinationSchema,
  itself: DestinationSchema.optional(),
});

export type FolderPick = z.output<typeof FolderPickSchema>;

/**
 * Refusals of a pick that a folder made inside it would only meet again,
 * so the pick itself is answered with them.
 */
const PICK_ITSELF_REFUSALS = new Set<MoveRefusal>([
  "current",
  "missing",
  "newer",
  "not-absolute",
  "pinned",
  "unfinished",
  "unwritable",
]);

/**
 * What a file manager leaves in a folder it showed, which is no one's work:
 * removed rather than carried along, so the old folder empties.
 */
const FILE_MANAGER_RECORDS = new Set([".DS_Store", "desktop.ini", "Thumbs.db"]);

type TargetFacts = {
  /** The folders the system empties on its own (`systemTemporaryDirs`). */
  temporaryDirs?: string[];
  userDataDir: string;
  workspace: Pick<ResolvedWorkspace, "id" | "pinned"> & {
    path: string | undefined;
  };
};

/**
 * Where a folder the person picked puts their Instrument folder: in a folder
 * named for it (`name`) inside the pick, or the pick itself where it already
 * has that name, already is an Instrument folder, or is refused for
 * something a folder inside it would meet as well. Where the folder inside
 * isn't there yet and the pick has other files in it that it could take the
 * Instrument folder beside, the pick itself comes back too, for the person
 * to choose between them.
 */
export function checkFolderPick({
  name,
  picked,
  ...facts
}: TargetFacts & { name: string; picked: string }): FolderPick {
  const describe = (dir: string, made = false): FolderPick["folder"] => {
    if (made && !entryExists(dir) && isDirectorySync(path.dirname(dir))) {
      return {
        contents: "new",
        path: dir,
        verdict: checkNewFolderTarget({ target: dir, ...facts }),
      };
    }
    return {
      contents: hasOtherFiles(dir) ? "files" : "empty",
      path: dir,
      verdict: checkMoveTarget({ target: dir, ...facts }),
    };
  };
  const itself = describe(picked);
  const keepsPick =
    path.basename(picked).toLowerCase() === name.toLowerCase() ||
    itself.verdict.kind === "workspace" ||
    (itself.verdict.kind === "refused" &&
      PICK_ITSELF_REFUSALS.has(itself.verdict.reason));
  if (keepsPick) {
    return { folder: itself };
  }
  const folder = describe(path.join(picked, name), true);
  return folder.contents === "new" &&
    itself.contents === "files" &&
    itself.verdict.kind === "movable"
    ? { folder, itself }
    : { folder };
}

/** Whether a folder has anything in it but a file manager's own records. */
function hasOtherFiles(dir: string) {
  try {
    return fs.readdirSync(dir).some((name) => !FILE_MANAGER_RECORDS.has(name));
  } catch {
    return false;
  }
}

/**
 * Whether the workspace could move to `target`, a folder not there yet that
 * the move makes: in a folder that is there and can be written to, and
 * anywhere `checkPlace` allows.
 */
function checkNewFolderTarget({
  target,
  temporaryDirs = systemTemporaryDirs(),
  userDataDir,
  workspace,
}: TargetFacts & { target: string }): MoveVerdict {
  if (workspace.pinned) {
    return { kind: "refused", reason: "pinned" };
  }
  if (!path.isAbsolute(target)) {
    return { kind: "refused", reason: "not-absolute" };
  }
  const { refusal, warning } = checkPlace({
    from: workspace.path,
    id: workspace.id,
    target,
    temporaryDirs,
    userDataDir,
  });
  const warned = warning === undefined ? {} : { warning };
  if (refusal !== undefined) {
    return { kind: "refused", reason: refusal, ...warned };
  }
  if (!canWrite(path.dirname(target))) {
    return { kind: "refused", reason: "unwritable", ...warned };
  }
  if (isUnsettled(workspace, userDataDir)) {
    return { kind: "refused", reason: "unfinished", ...warned };
  }
  return { kind: "movable", ...warned };
}

/**
 * Whether the workspace could move to `target`. A folder with other things
 * in it is fine (finished work in `~/Documents/Instrument`, say); one that
 * holds a workspace already is not a move, and the caller offers to open it.
 * A first launch's workspace has no folder yet (`path` undefined), and the
 * same answer says whether setup can place it there.
 */
export function checkMoveTarget({
  target,
  temporaryDirs = systemTemporaryDirs(),
  userDataDir,
  workspace,
}: TargetFacts & { target: string }): MoveVerdict {
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
  const { refusal, warning } = checkPlace({
    from: workspace.path,
    id: workspace.id,
    target,
    temporaryDirs,
    userDataDir,
  });
  const warned = warning === undefined ? {} : { warning };
  if (refusal !== undefined) {
    return { kind: "refused", reason: refusal, ...warned };
  }
  const dataDir = workspaceLayout(target).dataDir;
  if (entryExists(dataDir)) {
    // A link is no workspace's: it would have the move or the open act on
    // whatever it points to.
    if (!isDirectorySync(dataDir) || !hasWorkspaceIdentity(target)) {
      return refused("taken");
    }
    const identity = readWorkspaceIdentity(target);
    return identity.formatVersion > WORKSPACE_FORMAT_VERSION
      ? { kind: "refused", reason: "newer", ...warned }
      : { kind: "workspace", name: identity.name, ...warned };
  }
  if (!canWrite(target)) {
    return refused("unwritable");
  }
  if (isUnsettled(workspace, userDataDir)) {
    return refused("unfinished");
  }
  return { kind: "movable", ...warned };
}

/** Whether a workspace in the app's own data has layout sweeps still to finish there. */
function isUnsettled(
  workspace: TargetFacts["workspace"],
  userDataDir: string,
): boolean {
  return (
    workspace.path !== undefined &&
    pathWithin(workspace.path, userDataDir) &&
    !isSettled(workspace.path)
  );
}

/**
 * Why `target` cannot take the workspace with registry id `id`, now in
 * `from`, by where it is, compared where the folders really are: the
 * workspace's own folder or one around or inside it, or anywhere no
 * workspace can be (`folderConcern`). Anywhere `folderConcern` only warns
 * of, and the photo and media libraries apps keep for themselves, is
 * answered with the warning to show. Asked when the person picks the folder and
 * again when the move is made, since the folder can change in between; the
 * move goes past a warning, which the person saw when they picked.
 */
export function checkPlace({
  from,
  id,
  target,
  temporaryDirs,
  userDataDir,
}: {
  /** The workspace's folder now, or none for a first launch's not placed yet. */
  from: string | undefined;
  id: string;
  target: string;
  temporaryDirs: string[];
  userDataDir: string;
}): { refusal?: MoveRefusal; warning?: FolderWarning } {
  if (from !== undefined && samePath(target, from)) {
    return { refusal: "current" };
  }
  const opensInstead = hasWorkspaceIdentity(target);
  const concern = folderConcernHere({
    folder: target,
    // A workspace picked itself is one to open, never one around itself.
    otherWorkspaces: readRegistry(userDataDir)
      .workspaces.filter(
        (entry) =>
          entry.id !== id && !(opensInstead && samePath(entry.path, target)),
      )
      .map((entry) => entry.path),
    temporaryDirs,
    userDataDir,
  });
  if (concern?.kind === "refused") {
    return { refusal: concern.reason };
  }
  const warning =
    concern?.reason ??
    (placePaths(os.homedir()).some(
      (place) =>
        (place.id === "photos" || place.id === "mediaLibraries") &&
        place.paths.some((placePath) => samePath(target, placePath)),
    )
      ? "apps-data"
      : undefined);
  if (from === undefined) {
    return { warning };
  }
  if (pathWithin(target, from)) {
    return { refusal: "inside", warning };
  }
  if (pathWithin(from, target)) {
    return { refusal: "around", warning };
  }
  return { warning };
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
 * 4. The rest of `<from>`'s top level, the person's own (their chats,
 *    drafts, topics, memories, skills and apps), moves in beside the records
 *    where its name is free; a file manager's records go.
 * 5. Every path the app stored into `<from>` is written in the new folder
 *    (`rewriteStoredPaths`): the folder rules, a chat's grants, a topic's
 *    folders, a draft's attachments, the Files tabs a window is left on and
 *    the person's recent files.
 * 6. Last, the original set aside is deleted, and `<from>` removed once
 *    empty. A delete that fails part-way (a file another program holds
 *    open on Windows, a locked file) costs nothing, since nothing opens the
 *    aside: the pending move is kept with only this step left
 *    (`leftAside`), and each later launch tries it again.
 * 7. The pending move is cleared.
 *
 * A `.instrument` found at the target before step 1 is this move's own
 * copy only when it carries the move's mark, or when the original is gone
 * (a launch cut short between a same-volume rename and step 2). Anything
 * else there, another workspace's records or a link, stops the move and
 * leaves everything where it was. Another live process holding the
 * workspace (a second development instance) postpones the steps left to a
 * launch that finds it closed, and this launch opens the live copy. Never
 * throws: a step that fails is reported and retried on the next launch.
 *
 * Two launches at once take turns: the one making the move holds a lock in
 * the machine folder (`move.lock`) until it has marked the workspace open,
 * and the other waits for it, then reads the entry again and opens wherever
 * that left the workspace, as any launch that resolved the workspace before
 * another moved it does.
 */
export function finishPendingMove({
  temporaryDirs = systemTemporaryDirs(),
  userDataDir,
  workspace,
}: {
  /** The folders the system empties on its own (`systemTemporaryDirs`). */
  temporaryDirs?: string[];
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): { done: string[]; workspace: ResolvedWorkspace } {
  const entry = registryEntry(userDataDir, workspace.id);
  if (!entry || workspace.pinned) {
    return { done: [], workspace };
  }
  if (!entry.pendingMove) {
    return { done: [], workspace: atEntry(workspace, entry) };
  }
  const machineDir = workspaceMachineDirOf(userDataDir, workspace.id);
  return withMoveLock(machineDir, () => {
    try {
      // Read again once the lock is this launch's: a launch it waited for
      // may have made the move, or part of it, since.
      const current = registryEntry(userDataDir, workspace.id);
      if (!current?.pendingMove) {
        return {
          done: [],
          workspace: current ? atEntry(workspace, current) : workspace,
        };
      }
      return makeMove({
        entry: current,
        machineDir,
        pending: current.pendingMove,
        temporaryDirs,
        userDataDir,
        workspace: atEntry(workspace, current),
      });
    } finally {
      // Before the lock goes, so a launch that was waiting for it finds this
      // one holding the workspace.
      markWorkspaceOpen(machineDir);
    }
  });
}

/** `finishPendingMove`'s steps, with the move lock held. */
function makeMove({
  entry,
  machineDir,
  pending,
  temporaryDirs,
  userDataDir,
  workspace,
}: {
  entry: RegistryEntry;
  machineDir: string;
  pending: PendingMove;
  temporaryDirs: string[];
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): { done: string[]; workspace: ResolvedWorkspace } {
  const done: string[] = [];
  const { from, to } = pending;
  const fromData = workspaceLayout(from).dataDir;
  const toData = workspaceLayout(to).dataDir;
  const moved = { ...workspace, path: to };
  // By the path the entry records, never through links: a target that
  // became a link to the original is not a move already made.
  const pointed = path.resolve(entry.path) === path.resolve(to);
  let at = pointed ? moved : workspace;
  try {
    if (!pending.leftAside) {
      if (!pointed) {
        const placed =
          !isSameFolder(fromData, toData) &&
          (isPlacedCopy(toData, pending.copyMark) ||
            (!entryExists(fromData) && isRecordsOf(toData, entry.workspaceId)));
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
          // The sweeps that bring what 1.x and the betas left into this
          // build's shape run only while the workspace is in the app's own
          // data (`create-workspace-actor.ts`). Moving it out first would
          // leave them skipped for good, so a move picked before they
          // finished waits for the launch that does, and happens on the one
          // after. Nothing is lost by waiting: the pick stays recorded.
          if (pathWithin(from, userDataDir) && !isSettled(from)) {
            done.push(
              `left the move to ${to} until a launch has finished bringing ${from} up to date`,
            );
            return { done, workspace };
          }
          // The folder may have changed since it was picked.
          if (!isFolder(to)) {
            done.push(
              `left the move to ${to}, which is not a folder now; the next launch tries again`,
            );
            return { done, workspace };
          }
          const where = checkPlace({
            from,
            id: workspace.id,
            target: to,
            temporaryDirs,
            userDataDir,
          }).refusal;
          if (where !== undefined) {
            clearPendingMove(userDataDir, workspace.id);
            done.push(
              `did not move to ${to}, which it refuses now (${where}); left everything where it was`,
            );
            return { done, workspace };
          }
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
        if (isSameFolder(fromData, toData)) {
          done.push(`left ${fromData}, which is the target's own records`);
        } else if (isRecordsOf(fromData, entry.workspaceId)) {
          setAsideSync(fromData);
        } else {
          done.push(
            `left ${fromData}, which is not this workspace's records any more`,
          );
        }
      }
      // 4. The rest of the old folder.
      moveTheRest({ done, from, to });
      // 5. Stored paths written where they went.
      done.push(
        ...rewriteStoredPaths({
          machineDir,
          moves: [{ from, to }],
          rootDir: to,
        }),
      );
    }
    // 6. The original's records deleted, and the old folder once empty.
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
    // 7. Done.
    clearPendingMove(userDataDir, workspace.id);
  } catch (error) {
    done.push(
      `the move to ${to} stopped (${String(error)}); the next launch takes it up again`,
    );
  }
  return { done, workspace: at };
}

type RegistryEntry = WorkspaceRegistry["workspaces"][number];
type PendingMove = NonNullable<RegistryEntry["pendingMove"]>;

function registryEntry(userDataDir: string, id: string) {
  return readRegistry(userDataDir).workspaces.find((entry) => entry.id === id);
}

/**
 * The workspace where its entry says it is: a launch that resolved it
 * before another launch made its move has the old folder.
 */
function atEntry(
  workspace: ResolvedWorkspace,
  entry: RegistryEntry,
): ResolvedWorkspace {
  return path.resolve(entry.path) === path.resolve(workspace.path)
    ? workspace
    : { ...workspace, path: entry.path };
}

/**
 * Run `run` holding the workspace's move lock: a file in its machine folder
 * naming this process. A live launch of this app holding it is waited for,
 * however long its move takes, since going ahead would move the records
 * from under it; one that ended without removing it no longer counts.
 * Where the lock cannot be written at all, `run` goes ahead without it.
 */
/**
 * Take `lock` for this process, failing with EEXIST where another launch
 * holds it. The pid goes into a file of its own and that file is linked into
 * place, so the lock is never there with nothing in it yet: a launch that
 * read it in that moment would find no pid, take it for a lock whose process
 * had ended, remove it, and move the records from under the launch that holds
 * it.
 */
function takeMoveLock(lock: string): void {
  const staged = `${lock}.${process.pid.toString()}`;
  fs.writeFileSync(staged, process.pid.toString());
  try {
    fs.linkSync(staged, lock);
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

function withMoveLock<T>(machineDir: string, run: () => T): T {
  const lock = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.moveLock);
  let held = false;
  try {
    fs.mkdirSync(machineDir, { recursive: true });
    for (;;) {
      try {
        takeMoveLock(lock);
        held = true;
        break;
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) {
          break;
        }
      }
      if (liveHolderOf(lock) === null) {
        const left = readText(lock);
        // Unless another waiter took it over in the meantime.
        if (left !== undefined && readText(lock) === left) {
          fs.rmSync(lock, { force: true });
        }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  } catch {
    // No machine folder to lock in: the move goes ahead unlocked.
  }
  try {
    return run();
  } finally {
    if (held) {
      fs.rmSync(lock, { force: true });
    }
  }
}

function readText(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function isErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
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

/** Whether a path names a folder, through links. */
function isFolder(dir: string) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Whether two paths reach one folder, by its device and file id. */
function isSameFolder(a: string, b: string) {
  try {
    const first = fs.statSync(a, { bigint: true });
    const second = fs.statSync(b, { bigint: true });
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
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
    (identity.formatVersion >= MACHINE_DATA_FORMAT_VERSION &&
      identity.settingsVersion >= CURRENT_SETTINGS_VERSION &&
      identity.layoutVersion === WORKSPACE_LAYOUT_VERSION &&
      identity.legacyProjectsMigrated === true)
  );
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
