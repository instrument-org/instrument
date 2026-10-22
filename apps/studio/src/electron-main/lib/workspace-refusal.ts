import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import path from "node:path";

import { type FolderRefusal } from "../../shared/workspace-folder-refusal";
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
 * folder made by a newer build, which this one could only damage; a folder
 * it cannot read, which it never stands a new one in for; or a folder in a
 * place no workspace can be (`folderConcern`), such as the home folder.
 */
export type WorkspaceRefusal =
  | { kind: "misplaced"; reason: FolderRefusal; workspace: ResolvedWorkspace }
  | { kind: "newer"; workspace: ResolvedWorkspace }
  | {
      kind: "unreadable";
      /** Missing: the folder or its `.instrument/` is gone. Denied: the system will not let the app read it. */
      why: "denied" | "missing";
      workspace: ResolvedWorkspace;
    };

let refusal: undefined | WorkspaceRefusal;

/** Why this process opened no workspace, if it refused the one it resolved. */
export function getWorkspaceRefusal(): undefined | WorkspaceRefusal {
  return refusal;
}

export function setWorkspaceRefusal(refused: WorkspaceRefusal): void {
  refusal = refused;
}

/**
 * Whether this build can open the resolved workspace, as a value. Read
 * before anything else touches the folder:
 *
 * - its `workspace.json` names a format newer than this build knows;
 * - the system refuses to let it be read (macOS took back the app's access
 *   to Documents, say);
 * - a folder the person picked, or its `.instrument/`, is gone (a disk not
 *   connected, a folder moved by hand). One pinned for the process is made
 *   again instead, and a default one gone from the app's own data never gets
 *   here: the launch asks for a folder, as a first launch does
 *   (`needsPlacing`);
 * - a folder the person picked is somewhere no workspace can be, as an
 *   earlier build let it be. One somewhere the person is only warned about
 *   opens as any other does. One in the app's own data was made there by
 *   the app, and one pinned for the process is the pin's to place.
 */
export function inspectWorkspaceFolder({
  userDataDir,
  workspace,
}: {
  userDataDir: string;
  workspace: ResolvedWorkspace;
}): undefined | WorkspaceRefusal {
  let raw: string;
  try {
    raw = fs.readFileSync(
      path.join(workspaceLayout(workspace.path).dataDir, "workspace.json"),
      "utf8",
    );
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "EACCES" || code === "EPERM") {
      return { kind: "unreadable", why: "denied", workspace };
    }
    return workspace.pinned || pathWithin(workspace.path, userDataDir)
      ? undefined
      : { kind: "unreadable", why: "missing", workspace };
  }
  if (!workspace.pinned && !pathWithin(workspace.path, userDataDir)) {
    const concern = workspacePlaceConcern({
      dir: workspace.path,
      id: workspace.id,
      userDataDir,
    });
    if (concern?.kind === "refused") {
      return { kind: "misplaced", reason: concern.reason, workspace };
    }
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
