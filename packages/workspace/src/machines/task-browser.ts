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
import { z } from "zod";

import { closeAgentBrowserSessionsForSessions } from "../lib/agent-browser-cleanup";
import { recordBrowserClosed } from "../lib/browser-state";
import { TypedError } from "../lib/errors";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { type AbsolutePath } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type BrowserConfig, type BrowserTargetId } from "../types";

export const AGENT_IDLE_TIMEOUT_MS = ms("1 hour");
export const RETAINED_TIMEOUT_MS = ms("8 hours");
export const USER_PRESENCE_TIMEOUT_MS = ms("5 minutes");

/**
 * The two claims a viewer can hold on a task's browser.
 *
 * `visible` is the page the user is looking at. `retained` is a page that is
 * mounted but off screen, which is the ordinary state of a task the user has
 * open and will come back to. Keeping them apart is what lets a browser outlive
 * a glance at another task without outliving the task page itself: the client
 * holds `retained` for as long as it keeps the page alive and `visible` only
 * while showing it, so whatever decides that -- a background tab today, a
 * router's retained route tomorrow -- never has to be named here.
 */
export const BrowserPresenceLevelSchema = z.enum(["retained", "visible"]);

export type BrowserPresenceLevel = z.output<typeof BrowserPresenceLevelSchema>;

export interface TaskBrowserParentEvent {
  type: "taskBrowser.stopped";
  value: { id: TaskId };
}

interface DestroyAndCloseInput {
  browser: BrowserConfig;
  destroyedExternallyTargets: Set<BrowserTargetId>;
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
  taskId: TaskId;
  trashing: boolean;
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
  // One count per lease level, because a task page can be mounted more than
  // once (the same task in two tabs) and each mount holds its own.
  presence: Record<BrowserPresenceLevel, number>;
  // Set when the reap was ordered by trashing rather than by a lease or a
  // timeout, which is what tells the teardown its task is going away.
  trashing: boolean;
  // Targets we've already spawned a destruction watcher for. Used to gate
  // duplicate spawns on subsequent updateCdpHeartbeats for the same target.
  watchedTargets: Set<BrowserTargetId>;
}

type TaskBrowserEvent =
  | { type: "acquirePresence"; value: { level: BrowserPresenceLevel } }
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
  | { type: "releasePresence"; value: { level: BrowserPresenceLevel } }
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

    // Leave the fact behind for the next turn to tell the model about. A
    // failure here only costs that notice, never the teardown.
    //
    // A task on its way to the trash has no next turn to read it, and trashing
    // waits on this teardown only up to a short cap before removing the folder,
    // so by now there is usually nothing left to write to.
    if (input.trashing) {
      return;
    }

    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const recorded = await recordBrowserClosed({
          sessionId,
          taskId: input.taskId,
        });
        // A folder removed outside the app arrives as NotFound and means the
        // same thing as the trash case: the notice has nowhere to land.
        if (
          recorded.isErr() &&
          !(recorded.error instanceof TypedError.NotFound)
        ) {
          getWorkspaceConfig().captureException(recorded.error);
        }
      }),
    );
  },
);

export const taskBrowserMachine = setup({
  actions: {
    acquirePresence: assign({
      presence: ({ context }, { level }: { level: BrowserPresenceLevel }) => ({
        ...context.presence,
        [level]: context.presence[level] + 1,
      }),
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

    markTrashing: assign({ trashing: true }),

    notifyParentStopped: sendParent(({ context }) => ({
      type: "taskBrowser.stopped" as const,
      value: { id: context.id },
    })),

    releasePresence: assign({
      presence: ({ context }, { level }: { level: BrowserPresenceLevel }) => ({
        ...context.presence,
        [level]: Math.max(0, context.presence[level] - 1),
      }),
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
    RETAINED_TIMEOUT_MS,
    USER_PRESENCE_TIMEOUT_MS,
  },

  guards: {
    hasRetainedLease: ({ context }) => context.presence.retained > 0,
    hasVisibleLease: ({ context }) => context.presence.visible > 0,
    noLeases: ({ context }) =>
      context.presence.retained === 0 && context.presence.visible === 0,
    noVisibleLease: ({ context }) => context.presence.visible === 0,
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
    presence: { retained: 0, visible: 0 },
    trashing: false,
    watchedTargets: new Set<BrowserTargetId>(),
  }),
  id: "taskBrowser",
  initial: "Unobserved",
  on: {
    // Leases only move counts. Which state that leaves the browser in is decided
    // by the eventless transitions on each live state, so the rule lives in one
    // place instead of once per (state, event) pair.
    acquirePresence: {
      actions: {
        params: ({ event }) => event.value,
        type: "acquirePresence",
      },
    },
    attachAgentSession: {
      actions: {
        params: ({ event }) => event.value,
        type: "addKnownSession",
      },
    },
    forceReap: { actions: "markTrashing", target: ".Stopping" },
    releasePresence: {
      actions: {
        params: ({ event }) => event.value,
        type: "releasePresence",
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
    // Nobody has the task page open any more: it was closed, or a router
    // dropped it from whatever it keeps mounted. The page state a user could
    // return to went with it, so this is the short clock.
    GracePeriod: {
      after: {
        USER_PRESENCE_TIMEOUT_MS: { target: "Stopping" },
      },
      always: [
        { guard: "hasVisibleLease", target: "Observed" },
        { guard: "hasRetainedLease", target: "Retained" },
      ],
      on: {
        // A user opened the browser from the UI. Record the target (and spawn
        // its destruction watcher) without changing state: liveness is driven by
        // the presence lease the open panel holds, not by this event. Scoped to
        // the live states so a late open during teardown is ignored.
        registerTarget: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
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
    // The user is looking at this task's page (visible presence is scoped to
    // whatever is on screen, so at most one browser is Observed at a time).
    // While they are, the browser stays alive regardless of agent idleness --
    // reaping only happens once the page goes off screen (Retained), is closed
    // outright (GracePeriod), or nobody is watching at all (Unobserved idle
    // timer). Whoever is attending the browser, user or agent, keeps it warm.
    Observed: {
      always: [
        { guard: "noLeases", target: "GracePeriod" },
        { guard: "noVisibleLease", target: "Retained" },
      ],
      on: {
        registerTarget: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
        },
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
    // The task page is still open, just not on screen. A user who turns to
    // another task for a few minutes has not abandoned this one, and the page
    // they left behind is theirs to come back to, so this clock is long enough
    // to cover a working day's worth of switching away and back. It is also the
    // clock that ends an app session left running overnight, since a guest is a
    // painted renderer and holding every task's forever is not free.
    Retained: {
      after: {
        RETAINED_TIMEOUT_MS: { target: "Stopping" },
      },
      always: [
        { guard: "hasVisibleLease", target: "Observed" },
        { guard: "noLeases", target: "GracePeriod" },
      ],
      on: {
        registerTarget: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
        },
        // Agent work does not extend the retained clock, which already outlasts
        // the agent's own idle timeout; it only records target meta.
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
          taskId: context.id,
          trashing: context.trashing,
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
      always: [
        { guard: "hasVisibleLease", target: "Observed" },
        { guard: "hasRetainedLease", target: "Retained" },
      ],
      on: {
        registerTarget: {
          actions: {
            params: ({ event }) => event.value,
            type: "setTargetMeta",
          },
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
