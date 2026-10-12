import { type ActorRef, type MachineSnapshot } from "xstate";

import { type WorkspaceContext } from "../../machines/workspace/types";
import { type AbsolutePath } from "../../schemas/paths";
import { type BrowserTargetId } from "../../types";

export type WorkspaceServerParentEvent =
  // Surfaced by the CDP bridge when an agent-browser daemon connects so the
  // workspace's browser machine can track the page for daemon-close fan-out
  // at reap time.
  | {
      type: "workspaceServer.attachAgentSession";
      value: { targetId: BrowserTargetId };
    }
  // Surfaced by the CDP bridge for every non-intercepted CDP command sent by
  // agent-browser. Acts as the agent-activity heartbeat that resets the
  // browser machine's idle timer.
  | { type: "workspaceServer.error"; value: { error: Error } }
  | { type: "workspaceServer.started"; value: { port: number } }
  | {
      type: "workspaceServer.updateCdpHeartbeat";
      value: { partitionDir: AbsolutePath; targetId: BrowserTargetId };
    };

export type WorkspaceServerParentRef = ActorRef<
  // Needed so we can access the types-safe context from the parent
  // oxlint-disable-next-line typescript/no-explicit-any
  MachineSnapshot<WorkspaceContext, any, any, any, any, any, any, any>,
  WorkspaceServerParentEvent
>;
