import { type WorkspaceActorRef } from "../../machines/workspace";
import { startAppEvents } from "../apps/events";
import { setWorkspaceActorRef } from "../workspace-actor-ref";
import { startOrchestratorWake } from "./wake";

/**
 * Everything an orchestrator needs from the process that owns the workspace
 * actor: a way for its `task` command to reach the machine, and the
 * subscribers that wake it when a child finishes or the user acts on an app.
 * Called once per actor by whoever creates one, rather than by the machine
 * itself, so a test that builds a machine does not also start a subscriber
 * it never stops.
 */
export function attachOrchestrator(workspaceRef: WorkspaceActorRef): void {
  setWorkspaceActorRef(workspaceRef);
  startOrchestratorWake(workspaceRef);
  startAppEvents(workspaceRef);
}
