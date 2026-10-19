import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  entryExists,
  mergeEntrySync,
  removeIfEmptySync,
  rewriteStoredPaths,
  type StoredPathRewrite,
} from "@instrument-org/workspace/electron";
import { homeDataLayout } from "@instrument-org/workspace/layout";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { pathWithin } from "./path-identity";
import {
  defaultWorkspacePath,
  type ResolvedWorkspace,
  readWorkspaceIdentity,
  writeJsonAtomic,
} from "./workspaces";

/**
 * Where every workspace's work folders are on this computer,
 * `~/.instrument/work/`: one folder per workspace, and in it one per chat,
 * what the agent made for the person, apart from the app's own data.
 */
function workFoldersRoot(home = os.homedir()): string {
  return homeDataLayout(home).workDir;
}

const RecordSchema = z.object({
  /** The workspace's folder in `workFoldersRoot`. */
  name: z.string().min(1),
  /** Set once the work folders an earlier build kept are moved in. */
  moved: z.literal(true).optional(),
});

type WorkFoldersRecord = z.output<typeof RecordSchema>;

/** Characters a suffix is made of: lowercase, and no look-alikes. */
const SUFFIX_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SUFFIX_LENGTH = 4;
/** Longest the readable part of a name gets, before its suffix. */
const LABEL_LENGTH = 40;

/**
 * What the workspace's folder in `~/.instrument/work/` is called before its
 * suffix, as the person knows the workspace: the folder they picked for it,
 * or for one in the app's own data, the name of that data folder
 * (`Instrument`, `Instrument (Dev)`, a preview's), which tells copies of the
 * app apart, followed by the workspace's own folder for one made from the
 * dev panel. Lowercase, with a hyphen for anything but letters and digits,
 * as a chat's folder is, so a path to it needs no quoting.
 */
export function workspaceLabel({
  userDataDir,
  workspacePath,
}: {
  userDataDir: string;
  workspacePath: string;
}): string {
  const label = !pathWithin(workspacePath, userDataDir)
    ? path.basename(workspacePath)
    : path.resolve(workspacePath) ===
        path.resolve(defaultWorkspacePath(userDataDir))
      ? path.basename(userDataDir)
      : `${path.basename(userDataDir)} ${path.basename(workspacePath)}`;
  return (
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .slice(0, LABEL_LENGTH)
      .replaceAll(/^-+|-+$/g, "") || "workspace"
  );
}

/**
 * The names the workspace's folder is tried under, in order: its label with
 * the end of its own id, which is the same on every computer, then with a
 * random suffix, for a second copy of the app opening the same workspace.
 */
function candidateNames(
  label: string,
  workspaceId: string | undefined,
  random: () => string,
): string[] {
  const fromId = workspaceId?.slice(-SUFFIX_LENGTH).toLowerCase();
  return [
    ...(fromId ? [`${label}-${fromId}`] : []),
    ...Array.from({ length: 8 }, () => `${label}-${random()}`),
  ];
}

function randomSuffix(): string {
  return Array.from(
    { length: SUFFIX_LENGTH },
    () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)],
  ).join("");
}

function readRecord(machineDir: string): undefined | WorkFoldersRecord {
  try {
    const parsed = RecordSchema.safeParse(
      JSON.parse(
        fs.readFileSync(
          path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.workFolders),
          "utf8",
        ),
      ),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeRecord(machineDir: string, record: WorkFoldersRecord) {
  writeJsonAtomic(
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.workFolders),
    record,
  );
}

/**
 * Settles where the workspace's chats work on this computer,
 * `~/.instrument/work/<workspace>/`, and moves in the work folders an
 * earlier build kept in its machine folder. Runs at launch before any store
 * opens, and answers the folder.
 *
 * The name is settled once and recorded in the machine folder
 * (`WORKSPACE_MACHINE_ENTRIES.workFolders`), which is keyed by the
 * workspace's registry entry: a workspace renamed or moved keeps its
 * folder, and the name never has to be worked out again. It is claimed by
 * making the folder, which fails where anything is there already, so two
 * workspaces, or two copies of the app, never share one.
 *
 * The move is made chat by chat (`mergeEntrySync`: renamed on one volume,
 * copied whole beside its place and renamed in across volumes), so a launch
 * cut short leaves each chat's work in one place or the other, and the next
 * launch picks up where it stopped. The paths the app stored into the old
 * folder are written where they went, and the record says so once that is
 * done. Nothing here throws: a step that fails is said in what it answers,
 * and the folder is still the workspace's.
 */
export function settleWorkFolders({
  also = [],
  home = os.homedir(),
  machineDir,
  random = randomSuffix,
  userDataDir,
  workspace,
}: {
  /** Rewrites for stores Studio keeps (`storedPathRewrites`). */
  also?: readonly StoredPathRewrite[];
  home?: string;
  machineDir: string;
  random?: () => string;
  userDataDir: string;
  workspace: Pick<ResolvedWorkspace, "path">;
}): { done: string[]; workFoldersDir: string } {
  const done: string[] = [];
  const root = workFoldersRoot(home);
  let record = readRecord(machineDir);
  if (record === undefined) {
    const label = workspaceLabel({
      userDataDir,
      workspacePath: workspace.path,
    });
    const names = candidateNames(
      label,
      readWorkspaceIdentity(workspace.path).id,
      random,
    );
    try {
      fs.mkdirSync(root, { recursive: true });
      for (const name of names) {
        try {
          fs.mkdirSync(path.join(root, name));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            continue;
          }
          throw error;
        }
        record = { name };
        writeRecord(machineDir, record);
        done.push(`work folders are in ${path.join(root, name)}`);
        break;
      }
    } catch (error) {
      done.push(`could not settle the work folders: ${String(error)}`);
    }
    if (record === undefined) {
      // Unclaimed, and so not recorded: the next launch tries again.
      const name = names[0] ?? label;
      done.push(`work folders are in ${path.join(root, name)} for now`);
      return { done, workFoldersDir: path.join(root, name) };
    }
  }
  const workFoldersDir = path.join(root, record.name);
  if (!record.moved) {
    try {
      moveEarlierWorkFolders({
        also,
        done,
        machineDir,
        rootDir: workspace.path,
        workFoldersDir,
      });
      writeRecord(machineDir, { ...record, moved: true });
    } catch (error) {
      done.push(`stopped moving the work folders in: ${String(error)}`);
    }
  }
  return { done, workFoldersDir };
}

/**
 * Each chat's work folder from where builds before kept it, the machine
 * folder's `work/`, into the workspace's folder, merged into one that is
 * already there; then the paths stored into the old folder written where
 * they went. Throws when a move fails, leaving what it had not reached yet.
 */
function moveEarlierWorkFolders({
  also,
  done,
  machineDir,
  rootDir,
  workFoldersDir,
}: {
  also: readonly StoredPathRewrite[];
  done: string[];
  machineDir: string;
  rootDir: string;
  workFoldersDir: string;
}) {
  const earlier = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.work);
  if (!entryExists(earlier)) {
    return;
  }
  fs.mkdirSync(workFoldersDir, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(earlier)) {
    if (
      mergeEntrySync(
        path.join(earlier, name),
        path.join(workFoldersDir, name),
        (from, to) => {
          done.push(`left ${from}: ${to} is there already`);
        },
      )
    ) {
      moved++;
    }
  }
  removeIfEmptySync(earlier);
  done.push(
    `moved ${moved.toString()} work folder(s) from ${earlier} to ${workFoldersDir}`,
  );
  done.push(
    ...rewriteStoredPaths({
      also,
      machineDir,
      moves: [{ from: earlier, to: workFoldersDir }],
      rootDir,
    }),
  );
}
