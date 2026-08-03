import ms from "ms";
import {
  type ActorRefFrom,
  assign,
  fromPromise,
  sendParent,
  setup,
} from "xstate";

import { type TaskId } from "../schemas/task-id";
import { type BrowserConfig, type BrowserTargetId } from "../types";

// How long the guest survives with nobody showing it. Long enough to cover
// switching between two HTML files, flipping to another tab and back, or a
// route change that remounts the panel -- all of which drop and re-acquire the
// lease within a frame or two -- and short enough that a closed panel does not
// hold a webContents for any meaningful time.
export const ARTIFACT_PREVIEW_GRACE_MS = ms("30 seconds");

export interface ArtifactPreviewParentEvent {
  type: "artifactPreview.stopped";
  value: { id: TaskId };
}

interface ArtifactPreviewContext {
  browser: BrowserConfig;
  id: TaskId;
  presenceCount: number;
  // Null until an open registers the target it created. A machine spawned by a
  // presence lease that never got that far has nothing to close.
  targetId: BrowserTargetId | null;
}

type ArtifactPreviewEvent =
  | { type: "acquirePresence" }
  | { type: "forceReap" }
  | { type: "registerTarget"; value: { targetId: BrowserTargetId } }
  | { type: "releasePresence" }
  | { type: "targetDestroyedExternally" };

// Unlike taskBrowser's teardown this closes the one target and stops. There is
// no agent-browser daemon fan-out to do: an artifact guest is never a CDP
// session, so nothing holds `agent-browser close --session` state for it.
const closeTargetLogic = fromPromise<
  undefined,
  { browser: BrowserConfig; targetId: BrowserTargetId | null }
>(async ({ input }) => {
  if (input.targetId) {
    await input.browser.closeTarget(input.targetId);
  }
  return;
});

/**
 * Lifetime of a task's HTML artifact-preview guest.
 *
 * Deliberately not `taskBrowser`: that machine keys its targets by session id
 * and reaps on a 1-hour agent-idle clock, neither of which describes a passive
 * preview the user is looking at. What is left once those are dropped is a
 * presence lease and a short grace period.
 *
 * Three independent guards keep a webContents from leaking, because the
 * renderer asks for this resource and the main process owns it:
 * the lease rides an RPC subscription (an aborted stream releases it), the
 * grace timer fires on its own with nothing sent, and stopping the task reaps
 * unconditionally via the parent.
 */
export const artifactPreviewMachine = setup({
  actions: {
    acquirePresence: assign({
      presenceCount: ({ context }) => context.presenceCount + 1,
    }),

    clearTarget: assign({ targetId: null }),

    notifyParentStopped: sendParent(({ context }) => ({
      type: "artifactPreview.stopped" as const,
      value: { id: context.id },
    })),

    releasePresence: assign({
      presenceCount: ({ context }) => Math.max(0, context.presenceCount - 1),
    }),

    setTargetId: assign({
      targetId: (_, { targetId }: { targetId: BrowserTargetId }) => targetId,
    }),
  },

  actors: { closeTargetLogic },

  delays: { ARTIFACT_PREVIEW_GRACE_MS },

  guards: {
    hasOnePresence: ({ context }) => context.presenceCount === 1,
  },

  types: {
    context: {} as ArtifactPreviewContext,
    events: {} as ArtifactPreviewEvent,
    input: {} as { browser: BrowserConfig; id: TaskId },
  },
}).createMachine({
  context: ({ input }) => ({
    browser: input.browser,
    id: input.id,
    presenceCount: 0,
    targetId: null,
  }),
  id: "artifactPreview",
  initial: "GracePeriod",
  on: {
    forceReap: { target: ".Stopping" },
    // The guest died under us (renderer crash, window close). Forget the id so
    // teardown doesn't try to close an entry that is already gone.
    targetDestroyedExternally: {
      actions: "clearTarget",
      target: ".Stopping",
    },
  },
  states: {
    // Nobody is showing the preview. Reached both at birth (the open RPC
    // creates the target before the panel's lease arrives) and whenever the
    // last viewer goes away.
    GracePeriod: {
      after: {
        ARTIFACT_PREVIEW_GRACE_MS: { target: "Stopping" },
      },
      on: {
        acquirePresence: { actions: "acquirePresence", target: "Observed" },
        registerTarget: {
          actions: { params: ({ event }) => event.value, type: "setTargetId" },
        },
      },
    },
    // At least one mounted preview is showing this guest. Two can be at once:
    // the artifact panel and the expand modal over it both lease the same
    // target, which is why this counts rather than latches.
    Observed: {
      on: {
        acquirePresence: { actions: "acquirePresence" },
        registerTarget: {
          actions: { params: ({ event }) => event.value, type: "setTargetId" },
        },
        releasePresence: [
          {
            actions: "releasePresence",
            guard: "hasOnePresence",
            target: "GracePeriod",
          },
          { actions: "releasePresence" },
        ],
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
          targetId: context.targetId,
        }),
        onDone: { target: "Stopped" },
        onError: { target: "Stopped" },
        src: "closeTargetLogic",
      },
    },
  },
});

export type ArtifactPreviewActorRef = ActorRefFrom<
  typeof artifactPreviewMachine
>;
