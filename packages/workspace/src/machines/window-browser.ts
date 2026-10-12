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
import { type AbsolutePath } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type BrowserConfig, type BrowserTargetId } from "../types";

export const AGENT_IDLE_TIMEOUT_MS = ms("1 hour");
export const RETAINED_TIMEOUT_MS = ms("8 hours");
export const USER_PRESENCE_TIMEOUT_MS = ms("5 minutes");

/**
 * The two claims a viewer can hold on the window's browser.
 *
 * `visible` is a page the user is looking at. `retained` is a page that is
 * mounted but off screen, which is the ordinary state of a tab the user has
 * open and will come back to. Keeping them apart is what lets a browser outlive
 * a glance elsewhere without outliving the page itself: the client holds
 * `retained` for as long as it keeps the page alive and `visible` only while
 * showing it, so whatever decides that never has to be named here.
 */
export const BrowserPresenceLevelSchema = z.enum(["retained", "visible"]);

export type BrowserPresenceLevel = z.output<typeof BrowserPresenceLevelSchema>;

export interface WindowBrowserParentEvent {
  type: "windowBrowser.stopped";
}

interface DestroyAndCloseInput {
  browser: BrowserConfig;
  destroyedExternallyTargets: Set<BrowserTargetId>;
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
}

interface WindowBrowserContext {
  browser: BrowserConfig;
  // Set when an entry was destroyed by the host (renderer crash, window
  // close) so the reap path skips closeTarget but still cleans daemons.
  destroyedExternallyTargets: Set<BrowserTargetId>;
  // Map of (sessionId -> live target id). Value is undefined
  // for sessions seeded by `attachAgentSession` before any updateCdpHeartbeat
  // observed a real target id; the next updateCdpHeartbeat fills it in. We still
  // record the session so daemon cleanup runs even if no CDP traffic was
  // ever observed before reap.
  knownTargets: Map<StoreId.Session, BrowserTargetId | undefined>;
  partitionDir: AbsolutePath | null;
  // One count per lease level, because more than one viewer can hold the same
  // level and each holds its own.
  presence: Record<BrowserPresenceLevel, number>;
  // Targets we've already spawned a destruction watcher for. Used to gate
  // duplicate spawns on subsequent updateCdpHeartbeats for the same target.
  watchedTargets: Set<BrowserTargetId>;
}

type WindowBrowserEvent =
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
  WindowBrowserEvent,
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

export const windowBrowserMachine = setup({
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

    // The page is gone, the session stays known: its agent-browser session is
    // still closed when the browser stops.
    forgetTarget: assign({
      knownTargets: (
        { context },
        { targetId }: { targetId: BrowserTargetId },
      ) =>
        new Map(
          [...context.knownTargets].map(([sessionId, known]) => [
            sessionId,
            known === targetId ? undefined : known,
          ]),
        ),
      watchedTargets: (
        { context },
        { targetId }: { targetId: BrowserTargetId },
      ) => {
        const next = new Set(context.watchedTargets);
        next.delete(targetId);
        return next;
      },
    }),

    markExternalDestruction: assign({
      destroyedExternallyTargets: (
        { context },
        { targetId }: { targetId: BrowserTargetId },
      ) => new Set(context.destroyedExternallyTargets).add(targetId),
    }),

    notifyParentStopped: sendParent({ type: "windowBrowser.stopped" }),

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
    isLastTarget: ({ context }, { targetId }: { targetId: BrowserTargetId }) =>
      ![...context.knownTargets.values()].some(
        (known) => known !== undefined && known !== targetId,
      ),
    noLeases: ({ context }) =>
      context.presence.retained === 0 && context.presence.visible === 0,
    noVisibleLease: ({ context }) => context.presence.visible === 0,
  },

  types: {
    context: {} as WindowBrowserContext,
    events: {} as WindowBrowserEvent,
    input: {} as { browser: BrowserConfig },
  },
}).createMachine({
  context: ({ input }) => ({
    browser: input.browser,
    destroyedExternallyTargets: new Set<BrowserTargetId>(),
    knownTargets: new Map<StoreId.Session, BrowserTargetId | undefined>(),
    partitionDir: null,
    presence: { retained: 0, visible: 0 },
    watchedTargets: new Set<BrowserTargetId>(),
  }),
  id: "windowBrowser",
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
    forceReap: { target: ".Stopping" },
    releasePresence: {
      actions: {
        params: ({ event }) => event.value,
        type: "releasePresence",
      },
    },
    // One of the pages closed on its own (its tab closed, its window went):
    // the browser stops only once it was the last. The window holds every
    // page the person has open, so stopping on the first would close all the
    // others with it.
    targetDestroyedExternally: [
      {
        actions: {
          params: ({ event }) => ({ targetId: event.value.targetId }),
          type: "markExternalDestruction",
        },
        guard: {
          params: ({ event }) => ({ targetId: event.value.targetId }),
          type: "isLastTarget",
        },
        target: ".Stopping",
      },
      {
        actions: {
          params: ({ event }) => ({ targetId: event.value.targetId }),
          type: "forgetTarget",
        },
      },
    ],
  },
  states: {
    // Nobody has the window's pages open any more: the window closed, or
    // its renderer went. The page state a user could
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
    // The user is looking at a page. While they are, the browser stays alive regardless of agent idleness --
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
    // The pages are still open, just not on screen. A user who turns to
    // something else for a while has not abandoned them, and the page they
    // left behind is theirs to come back to, so this clock is long enough to
    // cover a working day's worth of switching away and back. It is also the
    // clock that ends an app session left running overnight, since a guest is
    // a painted renderer and holding every one forever is not free.
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

export type WindowBrowserActorRef = ActorRefFrom<typeof windowBrowserMachine>;
