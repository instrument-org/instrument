import { type LostReason } from "@/shared/setup";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

import { isDataless } from "./dataless";
import { pathWithin } from "./path-identity";
import {
  type ResolvedWorkspace,
  WorkspaceIdentitySchema,
  WORKSPACE_FORMAT_VERSION,
  workspacePlaceConcern,
} from "./workspaces";

/**
 * Why the resolved workspace is not opened, said back to the person in a
 * window of its own (`workspace-refusal-window.ts`) rather than thrown: a
 * folder made by a newer build, which this one could only damage.
 */
export type WorkspaceRefusal = { kind: "newer"; workspace: ResolvedWorkspace };

let refusal: undefined | WorkspaceRefusal;

/** Why this process opened no workspace, if it refused the one it resolved. */
export function getWorkspaceRefusal(): undefined | WorkspaceRefusal {
  return refusal;
}

export function setWorkspaceRefusal(refused: WorkspaceRefusal): void {
  refusal = refused;
}

/** How the launch finds the resolved workspace's folder (`inspectWorkspaceFolder`). */
export type FolderInspection =
  | undefined
  | WorkspaceRefusal
  | { code?: string; kind: "lost"; reason: LostReason }
  | { kind: "no-records" };

/** How long a failed read of the record waits before reading it again. */
const RETRY_WAIT_MS = 200;

/**
 * Whether this build can open the resolved workspace, read before anything
 * else touches the folder. Opened (`undefined`) unless:
 *
 * - `newer`: its `workspace.json` names a format newer than this build
 *   knows, which only an update opens;
 * - `lost`: the folder can't be opened where it is, for a `reason` setup's
 *   folder step says back. A folder that is there is lost only when its
 *   record can't be read now: one a cloud service keeps by name only is
 *   downloaded by setup rather than here, where the read would hold the
 *   launch for as long as the download takes, and one that fails to read
 *   twice is never opened, since opening writes the record again from what
 *   was read;
 * - `no-records`: the folder is there with no `.instrument/` in it, so what
 *   the app kept there was taken out. It opens as a new workspace there, and
 *   the bell says so.
 *
 * One pinned for the process is the pin's to place, and is made where it
 * isn't; one whose record is there but can't be read is lost like any
 * other, which the launch refuses to start on (`setup-environment.ts`),
 * since a pinned run has no setup to find it again. One in the app's own data whose folder is there but holds no
 * workspace yet (1.x tasks, or settings 1.x left at userData's root to take
 * in) opens, for the migrations to make it one.
 */
export function inspectWorkspaceFolder({
  userDataDir,
  workspace,
}: {
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): FolderInspection {
  const { dataDir } = workspaceLayout(workspace.path);
  const record = path.join(dataDir, "workspace.json");
  if (workspace.pinned) {
    if (isDataless(record)) {
      return { kind: "lost", reason: "cloud" };
    }
    const read = readRecord(record);
    if (typeof read === "string") {
      return newerThanThis(read, workspace);
    }
    return read.code === "ENOENT" ? undefined : lostFor(read.code);
  }
  const inAppData = pathWithin(workspace.path, userDataDir);
  const folder = statCode(workspace.path);
  if (folder !== undefined) {
    return inAppData &&
      fs.existsSync(path.join(userDataDir, "preferences.json"))
      ? undefined
      : lostFor(folder);
  }
  // Before the place is checked, which reads the record for the workspace's
  // id: setup checks it again once the record is downloaded.
  if (isDataless(record)) {
    return { kind: "lost", reason: "cloud" };
  }
  if (
    !inAppData &&
    workspacePlaceConcern({
      dir: workspace.path,
      id: workspace.id,
      userDataDir,
    })?.kind === "refused"
  ) {
    return { kind: "lost", reason: "refused" };
  }
  let read = readRecord(record);
  if (typeof read !== "string" && !lasting(read.code)) {
    // A read that failed for no reason the folder explains, such as a cloud
    // service that couldn't answer in time, is tried once more.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_WAIT_MS);
    read = readRecord(record);
  }
  if (typeof read === "string") {
    return newerThanThis(read, workspace);
  }
  if (read.code === "ENOENT") {
    return inAppData || fs.existsSync(dataDir)
      ? undefined
      : { kind: "no-records" };
  }
  // The read itself asks the cloud service for the file, and a failed ask
  // leaves it in the cloud.
  if (isDataless(record)) {
    return { kind: "lost", reason: "cloud" };
  }
  return lostFor(read.code);
}

/** The record's text, or the code its read failed with. */
function readRecord(file: string): string | { code: string | undefined } {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    return { code: errorCode(error) };
  }
}

/** The code `stat` fails with on the folder, or undefined when it is one. */
function statCode(dir: string): string | undefined {
  try {
    return fs.statSync(dir).isDirectory() ? undefined : "ENOTDIR";
  } catch (error) {
    return errorCode(error) ?? "EIO";
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/** A code that says something lasting about the folder, which reading again won't change. */
function lasting(code: string | undefined): boolean {
  return (
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "EACCES" ||
    code === "EPERM"
  );
}

/** What a failed read of the folder or its record with `code` says about it. */
export function lostFor(code: string | undefined): {
  code?: string;
  kind: "lost";
  reason: LostReason;
} {
  if (code === "ENOENT" || code === "ENOTDIR") {
    return { kind: "lost", reason: "missing" };
  }
  if (code === "EACCES" || code === "EPERM") {
    return { kind: "lost", reason: "denied" };
  }
  return { kind: "lost", reason: "unreadable", ...(code ? { code } : {}) };
}

function newerThanThis(
  raw: string,
  workspace: ResolvedWorkspace,
): undefined | WorkspaceRefusal {
  let identity: unknown;
  try {
    identity = JSON.parse(raw);
  } catch {
    // A damaged record says nothing of its format; the settings migration
    // writes it again.
    return undefined;
  }
  const parsed = WorkspaceIdentitySchema.safeParse(identity);
  return parsed.success && parsed.data.formatVersion > WORKSPACE_FORMAT_VERSION
    ? { kind: "newer", workspace }
    : undefined;
}
