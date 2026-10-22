import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Whether this build can open the resolved workspace, read before anything
 * else touches the folder:
 *
 * - `newer`: its `workspace.json` names a format newer than this build
 *   knows, which only an update opens;
 * - `lost`: the folder can't be opened where it is. It's gone (a disk not
 *   connected, a folder moved or deleted by hand), the system won't let it
 *   be read (macOS took back the app's access to Documents, say), or it's
 *   somewhere no workspace can be, as an earlier build let it be. Setup's
 *   folder step asks for it again. One somewhere the person is only warned
 *   about opens as any other does.
 *
 * One pinned for the process is the pin's to place, and is made where it
 * isn't. One in the app's own data whose folder is there but holds no
 * workspace yet (1.x tasks, or settings 1.x left at userData's root to take
 * in) opens, for the migrations to make it one.
 */
export function inspectWorkspaceFolder({
  userDataDir,
  workspace,
}: {
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): "lost" | undefined | WorkspaceRefusal {
  let raw: string;
  try {
    raw = fs.readFileSync(
      path.join(workspaceLayout(workspace.path).dataDir, "workspace.json"),
      "utf8",
    );
  } catch (error) {
    if (workspace.pinned) {
      return undefined;
    }
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "EACCES" || code === "EPERM") {
      return "lost";
    }
    return pathWithin(workspace.path, userDataDir) &&
      (fs.existsSync(workspace.path) ||
        fs.existsSync(path.join(userDataDir, "preferences.json")))
      ? undefined
      : "lost";
  }
  if (
    !workspace.pinned &&
    !pathWithin(workspace.path, userDataDir) &&
    workspacePlaceConcern({
      dir: workspace.path,
      id: workspace.id,
      userDataDir,
    })?.kind === "refused"
  ) {
    return "lost";
  }
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
