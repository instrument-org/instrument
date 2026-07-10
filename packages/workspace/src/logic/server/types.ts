import { type ActorRef, type MachineSnapshot } from "xstate";

import { type RuntimeActorRef } from "../../machines/runtime";
import { type WorkspaceContext } from "../../machines/workspace/types";
import { type AbsolutePath } from "../../schemas/paths";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { type BrowserTargetId, type WorkspaceConfig } from "../../types";

export interface WorkspaceServerEnv {
  Variables: {
    getRuntimeRef: (id: TaskId) => RuntimeActorRef | undefined;
    parentRef: WorkspaceServerParentRef;
    shimClientDir: "dev-server" | AbsolutePath;
    workspaceConfig: WorkspaceConfig;
  };
}

export type WorkspaceServerParentEvent =
  // Surfaced by the CDP bridge when an agent-browser daemon connects so the
  // workspace's taskBrowser machine can track the originating session id
  // for daemon-close fan-out at reap time.
  | {
      type: "workspaceServer.attachAgentSession";
      value: { id: TaskId; sessionId: StoreId.Session };
    }
  // Surfaced by the CDP bridge for every non-intercepted CDP command sent by
  // agent-browser. Acts as the agent-activity heartbeat that resets the
  // taskBrowser machine's idle timer.
  | { type: "workspaceServer.error"; value: { error: Error } }
  | {
      type: "workspaceServer.heartbeat";
      value: {
        createdAt: number;
        shouldCreate: boolean;
        taskId: TaskId;
      };
    }
  | { type: "workspaceServer.started"; value: { port: number } }
  | {
      type: "workspaceServer.updateCdpHeartbeat";
      value: {
        id: TaskId;
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        targetId: BrowserTargetId;
      };
    };

export type WorkspaceServerParentRef = ActorRef<
  // Needed so we can access the types-safe context from the parent
  // oxlint-disable-next-line typescript/no-explicit-any
  MachineSnapshot<WorkspaceContext, any, any, any, any, any, any, any>,
  WorkspaceServerParentEvent
>;
