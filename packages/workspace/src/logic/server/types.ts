import { type ActorRef, type MachineSnapshot } from "xstate";

import { type WorkspaceContext } from "../../machines/workspace/types";
import { type BrowserTargetId } from "../../types";

export type WorkspaceServerParentEvent =
  | { type: "workspaceServer.error"; value: { error: Error } }
  | { type: "workspaceServer.started"; value: { port: number } }
  // Surfaced by the CDP bridge for every command agent-browser sends a page,
  // so a guest the agent made is known to the browser's lifetime.
  | {
      type: "workspaceServer.updateCdpHeartbeat";
      value: { targetId: BrowserTargetId };
    };

export type WorkspaceServerParentRef = ActorRef<
  // Needed so we can access the types-safe context from the parent
  // oxlint-disable-next-line typescript/no-explicit-any
  MachineSnapshot<WorkspaceContext, any, any, any, any, any, any, any>,
  WorkspaceServerParentEvent
>;
