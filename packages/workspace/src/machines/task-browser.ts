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
import { type TaskId } from "../schemas/task-id";
import { type BrowserConfig, type BrowserTargetId } from "../types";

export const AGENT_IDLE_TIMEOUT_MS = ms("1 hour");
export const USER_PRESENCE_TIMEOUT_MS = ms("5 minutes");

export interface TaskBrowserParentEvent {
  type: "taskBrowser.stopped";
  value: { id: TaskId };
}

interface DestroyAndCloseInput {
  browser: BrowserConfig;
  destroyedExternallyTargets: Set<BrowserTargetId>;
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
}

interface TaskBrowserContext {
  browser: BrowserConfig;
  // Set when an entry was destroyed by the host (renderer crash, window
  // close) so the reap path skips closeTarget but still cleans daemons.
  destroyedExternallyTargets: Set<BrowserTargetId>;
  id: TaskId;
  // Per-task map of (sessionId -> live target id). Value is undefined
  // for sessions seeded by `attachAgentSession` before any updateCdpHeartbeat
  // observed a real target id; the next updateCdpHeartbeat fills it in. We still
  // record the session so daemon cleanup runs even if no CDP traffic was
  // ever observed before reap.
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
  partitionDir: AbsolutePath | null;
  presenceCount: number;
  // Targets we've already spawned a destruction watcher for. Used to gate
  // duplicate spawns on subsequent updateCdpHeartbeats for the same target.
  watchedTargets: Set<BrowserTargetId>;
}

type TaskBrowserEvent =
  | { type: "acquirePresence" }
  | { type: "attachAgentSession"; value: { sessionId: StoreId.Session } }
  | { type: "forceReap" }
  | {
      type: "registerTarget";
      value: {
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        targetId: BrowserTargetId;
      };
    }
  | { type: "releasePresence" }
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
    };

// Bridges the engine-agnostic BrowserConfig.onTargetDestroyed callback into a
// machine event. Spawned per target on first observation; unsubscribes when
// the parent state stops (i.e. when we transition to Stopping/Stopped).
const watchTargetDestructionLogic = fromCallback<
  TaskBrowserEvent,
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

export const taskBrowserMachine = setup({
  actions: {
    acquirePresence: assign({
      presenceCount: ({ context }) => context.presenceCount + 1,
    }),

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
      type: "taskBrowser.stopped" as const,
      value: { id: context.id },
    })),

    releasePresence: assign({
      presenceCount: ({ context }) => Math.max(0, context.presenceCount - 1),
    }),

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

  guards: {
    hasOnePresence: ({ context }) => context.presenceCount === 1,
  },

  types: {
    context: {} as TaskBrowserContext,
    events: {} as TaskBrowserEvent,
    input: {} as { browser: BrowserConfig; id: TaskId },
  },
}).createMachine({
  context: ({ input }) => ({
    browser: input.browser,
    destroyedExternallyTargets: new Set<BrowserTargetId>(),
    id: input.id,
    knownTargets: new Map<StoreId.Session, BrowserTargetId | undefined>(),
    partitionDir: null,
    presenceCount: 0,
    watchedTargets: new Set<BrowserTargetId>(),
  }),
  id: "taskBrowser",
  initial: "Unobserved",
  on: {
    attachAgentSession: {
      actions: {
        params: ({ event }) => event.value,
        type: "addKnownSession",
      },
    },
    forceReap: { target: ".Stopping" },
    // A user opened the browser from the UI (no agent CDP traffic yet). Record
    // the target so reap closes it and spawn its destruction watcher, without
    // changing state: liveness is driven by the presence lease the open panel
    // holds, not by this event.
    registerTarget: {
      actions: {
        params: ({ event }) => event.value,
        type: "setTargetMeta",
      },
    },
    targetDestroyedExternally: {
      actions: {
        params: ({ event }) => ({ targetId: event.value.targetId }),
        type: "markExternalDestruction",
      },
      target: ".Stopping",
    },
  },
  states: {
    GracePeriod: {
      after: {
        USER_PRESENCE_TIMEOUT_MS: { target: "Stopping" },
      },
      on: {
        acquirePresence: {
          actions: "acquirePresence",
          target: "Observed",
        },
        updateCdpHeartbeat: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
          target: "Unobserved",
        },
      },
    },
    // The user is present on this tab (presence is foreground-tab scoped, so at
    // most one browser is Observed at a time). While present, the browser stays
    // alive regardless of agent idleness -- reaping only happens once the user
    // leaves (GracePeriod) or when nobody is watching (Unobserved idle timer).
    // Whoever is attending the browser, user or agent, keeps it warm.
    Observed: {
      on: {
        acquirePresence: { actions: "acquirePresence" },
        releasePresence: [
          {
            actions: "releasePresence",
            guard: "hasOnePresence",
            target: "GracePeriod",
          },
          { actions: "releasePresence" },
        ],
        // No state change: the browser is already kept alive by presence, so a
        // heartbeat only needs to record target meta (and spawn its watcher).
        updateCdpHeartbeat: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
        },
      },
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
    Unobserved: {
      after: {
        AGENT_IDLE_TIMEOUT_MS: { target: "Stopping" },
      },
      on: {
        acquirePresence: {
          actions: "acquirePresence",
          target: "Observed",
        },
        updateCdpHeartbeat: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
          reenter: true,
          target: "Unobserved",
        },
      },
    },
  },
});

export type TaskBrowserActorRef = ActorRefFrom<typeof taskBrowserMachine>;
