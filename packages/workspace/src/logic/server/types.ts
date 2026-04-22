import { type ActorRef, type MachineSnapshot } from "xstate";

import { type AppConfig } from "../../lib/app-config/types";
import { type RuntimeActorRef } from "../../machines/runtime";
import { type WorkspaceContext } from "../../machines/workspace/types";
import { type AbsolutePath } from "../../schemas/paths";
import { type StoreId } from "../../schemas/store-id";
import {
  type AppSubdomain,
  type ProjectSubdomain,
} from "../../schemas/subdomains";
import { type BrowserTargetId, type WorkspaceConfig } from "../../types";

export interface WorkspaceServerEnv {
  Variables: {
    getRuntimeRef: (subdomain: AppSubdomain) => RuntimeActorRef | undefined;
    parentRef: WorkspaceServerParentRef;
    shimClientDir: "dev-server" | AbsolutePath;
    workspaceConfig: WorkspaceConfig;
  };
}

export type WorkspaceServerParentEvent =
  // Surfaced by the CDP bridge when an agent-browser daemon connects so the
  // workspace's projectBrowser machine can track the originating session id
  // for daemon-close fan-out at reap time.
  | {
      type: "workspaceServer.attachAgentSession";
      value: { sessionId: StoreId.Session; subdomain: ProjectSubdomain };
    }
  // Surfaced by the CDP bridge for every non-intercepted CDP command sent by
  // agent-browser. Acts as the agent-activity heartbeat that resets the
  // projectBrowser machine's idle timer.
  | { type: "workspaceServer.error"; value: { error: Error } }
  | {
      type: "workspaceServer.heartbeat";
      value: {
        appConfig: AppConfig;
        createdAt: number;
        shouldCreate: boolean;
      };
    }
  | { type: "workspaceServer.started"; value: { port: number } }
  | {
      type: "workspaceServer.updateCdpHeartbeat";
      value: {
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        subdomain: ProjectSubdomain;
        targetId: BrowserTargetId;
      };
    };

export type WorkspaceServerParentRef = ActorRef<
  // Needed so we can access the types-safe context from the parent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MachineSnapshot<WorkspaceContext, any, any, any, any, any, any, any>,
  WorkspaceServerParentEvent
>;
