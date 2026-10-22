import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";

/** The running workspace: its actor, and the config the RPC routes read. */
export interface StartedWorkspace {
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}

let started: StartedWorkspace | undefined;

/** Recorded once by `startWorkspace`. */
export function setStartedWorkspace(workspace: StartedWorkspace): void {
  started = workspace;
}

/** Whether the workspace is running, which a first launch's is only after setup places it. */
export function isWorkspaceStarted(): boolean {
  return started !== undefined;
}

/**
 * The running workspace, for the RPC routes that reach it. Throws before it
 * starts: nothing a first launch shows before setup places the workspace
 * asks for it.
 */
export function getStartedWorkspace(): StartedWorkspace {
  if (!started) {
    throw new Error("The workspace was asked for before it started");
  }
  return started;
}
