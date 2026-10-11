import { type ActorRef, type MachineSnapshot } from "xstate";

import { type WorkspaceContext } from "../../machines/workspace/types";
import { type AbsolutePath } from "../../schemas/paths";
import { type StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { type BrowserTargetId } from "../../types";

export type WorkspaceServerParentEvent =
  // Surfaced by the CDP bridge when an agent-browser daemon connects so the
  // workspace's chatBrowser machine can track the originating session id
  // for daemon-close fan-out at reap time.
  | {
      type: "workspaceServer.attachAgentSession";
      value: { id: ChatId; sessionId: StoreId.Session };
    }
  // Surfaced by the CDP bridge for every non-intercepted CDP command sent by
  // agent-browser. Acts as the agent-activity heartbeat that resets the
  // chatBrowser machine's idle timer.
  | { type: "workspaceServer.error"; value: { error: Error } }
  | { type: "workspaceServer.started"; value: { port: number } }
  | {
      type: "workspaceServer.updateCdpHeartbeat";
      value: {
        id: ChatId;
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
