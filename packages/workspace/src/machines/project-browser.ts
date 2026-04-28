import ms from "ms";
import {
  type ActorRefFrom,
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  sendParent,
  setup,
} from "xstate";

import { closeAgentBrowserSessionsForSessions } from "../lib/agent-browser-cleanup";
import { type AbsolutePath } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type BrowserConfig, type BrowserTargetId } from "../types";

export const AGENT_IDLE_TIMEOUT_MS = ms("1 hour");
export const USER_PRESENCE_TIMEOUT_MS = ms("5 minutes");
export const USER_HEARTBEAT_INTERVAL_MS = ms("5 seconds");

export interface ProjectBrowserParentEvent {
  type: "projectBrowser.stopped";
  value: { subdomain: ProjectSubdomain };
}

interface DestroyAndCloseInput {
  browser: BrowserConfig;
  destroyedExternallyTargets: Set<BrowserTargetId>;
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
}

interface ProjectBrowserContext {
  browser: BrowserConfig;
  // Set when an entry was destroyed by the host (renderer crash, window
  // close) so the reap path skips closeTarget but still cleans daemons.
  destroyedExternallyTargets: Set<BrowserTargetId>;
  // Per-project map of (sessionId -> live target id). Value is undefined
  // for sessions seeded by `attachAgentSession` before any updateCdpHeartbeat
  // observed a real target id; the next updateCdpHeartbeat fills it in. We still
  // record the session so daemon cleanup runs even if no CDP traffic was
  // ever observed before reap.
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
  partitionDir: AbsolutePath | null;
  subdomain: ProjectSubdomain;
  // Targets we've already spawned a destruction watcher for. Used to gate
  // duplicate spawns on subsequent updateCdpHeartbeats for the same target.
  watchedTargets: Set<BrowserTargetId>;
}

type ProjectBrowserEvent =
  | { type: "attachAgentSession"; value: { sessionId: StoreId.Session } }
  | { type: "forceReap" }
  | {
      type: "targetDestroyedExternally";
      value: { targetId: BrowserTargetId };
    }
  | {
      type: "updateCdpHeartbeat";
      value: {
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        targetId: BrowserTargetId;
      };
    }
  | { type: "updateUserHeartbeat" };

// Bridges the engine-agnostic BrowserConfig.onTargetDestroyed callback into a
// machine event. Spawned per target on first observation; unsubscribes when
// the parent state stops (i.e. when we transition to Stopping/Stopped).
const watchTargetDestructionLogic = fromCallback<
  ProjectBrowserEvent,
  { browser: BrowserConfig; targetId: BrowserTargetId }
>(({ input, sendBack }) =>
  input.browser.onTargetDestroyed(input.targetId, () => {
    sendBack({
      type: "targetDestroyedExternally",
      value: { targetId: input.targetId },
    });
  }),
);

const destroyAndCloseLogic = fromPromise<undefined, DestroyAndCloseInput>(
  async ({ input }) => {
    // closeTarget is idempotent (resolves immediately for unknown targets)
    // so racing with an external destruction is fine.
    const closeOps: Promise<void>[] = [];
    for (const targetId of input.knownTargets.values()) {
      if (!targetId || input.destroyedExternallyTargets.has(targetId)) {
        continue;
      }
      closeOps.push(input.browser.closeTarget(targetId));
    }
    await Promise.all(closeOps);

    const sessionIds = [...input.knownTargets.keys()];
    if (sessionIds.length > 0) {
      await closeAgentBrowserSessionsForSessions(sessionIds);
    }
  },
);

export const projectBrowserMachine = setup({
  actions: {
    addKnownSession: assign({
      knownTargets: (
        { context },
        { sessionId }: { sessionId: StoreId.Session },
      ) => {
        if (context.knownTargets.has(sessionId)) {
          return context.knownTargets;
        }
        return new Map(context.knownTargets).set(sessionId, undefined);
      },
    }),

    markExternalDestruction: assign({
      destroyedExternallyTargets: (
        { context },
        { targetId }: { targetId: BrowserTargetId },
      ) => new Set(context.destroyedExternallyTargets).add(targetId),
    }),

    notifyParentStopped: sendParent(({ context }) => ({
      type: "projectBrowser.stopped" as const,
      value: { subdomain: context.subdomain },
    })),

    setTargetMeta: enqueueActions(
      (
        { enqueue },
        params: {
          partitionDir: AbsolutePath;
          sessionId: StoreId.Session;
          targetId: BrowserTargetId;
        },
      ) => {
        enqueue.assign(({ context: ctx, spawn }) => {
          const knownTargets = new Map(ctx.knownTargets).set(
            params.sessionId,
            params.targetId,
          );
          let watchedTargets = ctx.watchedTargets;
          if (!ctx.watchedTargets.has(params.targetId)) {
            spawn("watchTargetDestructionLogic", {
              input: { browser: ctx.browser, targetId: params.targetId },
            });
            watchedTargets = new Set(ctx.watchedTargets).add(params.targetId);
          }
          return {
            knownTargets,
            partitionDir: params.partitionDir,
            watchedTargets,
          };
        });
      },
    ),
  },

  actors: {
    destroyAndCloseLogic,
    watchTargetDestructionLogic,
  },

  delays: {
    AGENT_IDLE_TIMEOUT_MS,
    USER_PRESENCE_TIMEOUT_MS,
  },

  types: {
    context: {} as ProjectBrowserContext,
    events: {} as ProjectBrowserEvent,
    input: {} as { browser: BrowserConfig; subdomain: ProjectSubdomain },
  },
}).createMachine({
  context: ({ input }) => ({
    browser: input.browser,
    destroyedExternallyTargets: new Set<BrowserTargetId>(),
    knownTargets: new Map<StoreId.Session, BrowserTargetId | undefined>(),
    partitionDir: null,
    subdomain: input.subdomain,
    watchedTargets: new Set<BrowserTargetId>(),
  }),
  id: "projectBrowser",
  initial: "Active",
  states: {
    Active: {
      on: {
        attachAgentSession: {
          actions: {
            params: ({ event }) => event.value,
            type: "addKnownSession",
          },
        },
        forceReap: { target: "Stopping" },
        targetDestroyedExternally: {
          actions: {
            params: ({ event }) => ({ targetId: event.value.targetId }),
            type: "markExternalDestruction",
          },
          target: "Stopping",
        },
      },
      states: {
        Agent: {
          initial: "Watching",
          states: {
            Watching: {
              after: {
                AGENT_IDLE_TIMEOUT_MS: { target: "#projectBrowser.Stopping" },
              },
              on: {
                updateCdpHeartbeat: {
                  actions: {
                    params: ({ event }) => event.value,
                    type: "setTargetMeta",
                  },
                  reenter: true,
                  target: "Watching",
                },
              },
            },
          },
        },
        User: {
          initial: "Watching",
          states: {
            Watching: {
              after: {
                USER_PRESENCE_TIMEOUT_MS: {
                  target: "#projectBrowser.Stopping",
                },
              },
              on: {
                updateUserHeartbeat: { reenter: true, target: "Watching" },
              },
            },
          },
        },
      },
      type: "parallel",
    },
    Stopped: {
      entry: "notifyParentStopped",
      type: "final",
    },
    Stopping: {
      invoke: {
        input: ({ context }) => ({
          browser: context.browser,
          destroyedExternallyTargets: context.destroyedExternallyTargets,
          knownTargets: context.knownTargets,
        }),
        onDone: { target: "Stopped" },
        onError: { target: "Stopped" },
        src: "destroyAndCloseLogic",
      },
    },
  },
});

export type ProjectBrowserActorRef = ActorRefFrom<typeof projectBrowserMachine>;
