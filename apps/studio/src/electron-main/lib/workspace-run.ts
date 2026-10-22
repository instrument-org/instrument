import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";

import { type OpenWorkspace } from "./workspaces";

/**
 * Where the workspace this process runs is, in its one order: no folder yet
 * (a first launch, or a folder that went missing, with where it was), then
 * placed in a folder, then started. A launch begins at the first or the
 * second; the only ways on are placing and starting.
 */
export type WorkspaceRun =
  | {
      kind: "unplaced";
      /** The local id it will be registered under. */
      id: string;
      /** Where the folder it had was, when one went missing. */
      lost?: string;
      /** This computer's folder for it, where the window's session already is. */
      machineDir: string;
    }
  | { kind: "placed"; workspace: OpenWorkspace }
  | {
      kind: "started";
      workspace: OpenWorkspace;
      workspaceConfig: WorkspaceConfig;
      workspaceRef: WorkspaceActorRef;
    };

let run: undefined | WorkspaceRun;

/** Where the launch leaves the workspace, before any store opens (`setup-environment.ts`). */
export function beginWorkspaceRun(
  first: Extract<WorkspaceRun, { kind: "placed" | "unplaced" }>,
): void {
  run = first;
}

export function getWorkspaceRun(): WorkspaceRun {
  if (!run) {
    throw new Error(
      "The workspace was read before setup-environment resolved it",
    );
  }
  return run;
}

/** Gives an unplaced workspace its folder (`placeWorkspace`). */
export function placeRun(workspace: OpenWorkspace): void {
  if (getWorkspaceRun().kind !== "unplaced") {
    throw new Error("The workspace has a folder");
  }
  run = { kind: "placed", workspace };
}

/** Records the placed workspace as running (`startWorkspace`). */
export function startRun(started: {
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}): void {
  const current = getWorkspaceRun();
  if (current.kind !== "placed") {
    throw new Error(`A workspace ${current.kind} can't start`);
  }
  run = { kind: "started", workspace: current.workspace, ...started };
}

/**
 * The workspace this process runs, once it has a folder. A read before that
 * would put a store in the wrong folder, so it throws instead.
 */
export function getResolvedWorkspace(): OpenWorkspace {
  const current = getWorkspaceRun();
  if (current.kind === "unplaced") {
    throw new Error("The workspace was read before setup placed it");
  }
  return current.workspace;
}

/**
 * The local id and machine folder of the workspace this process runs,
 * placed or not: what is this computer's own about it is there from the
 * start of a first launch.
 */
export function getLocalWorkspace(): { id: string; machineDir: string } {
  const current = getWorkspaceRun();
  return current.kind === "unplaced" ? current : current.workspace;
}
