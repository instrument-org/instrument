import { assign, fromPromise, setup } from "xstate";

/**
 * How long closing the agent browser sessions may take before teardown moves
 * on without them.
 */
export const BROWSER_SESSIONS_CLOSE_MS = 3000;

/**
 * A quit, from the first ask to `app.exit`.
 *
 * One user-initiated quit reaches the app more than once: outside macOS the
 * window close asks first, then the destroyed window triggers
 * `window-all-closed` -> `app.quit()` -> `before-quit`. So approval is a state
 * of its own that every path shares and that latches once given, and the
 * teardown runs once however many `before-quit`s arrive while it does.
 *
 * Teardown closes the agent browser sessions (bounded on its own), then tears
 * down the browser views and stops the services, while the telemetry flush runs
 * alongside the whole of it. One deadline over everything means a step that
 * hangs still ends in an exit.
 */
export const quitMachine = setup({
  actions: {
    /** Brings a window back to the front after a canceled quit. */
    reveal: () => {},
    announce: (_, _params: { stage: string }) => {},
    reportBrowserSessionsTimeout: () => {},
    teardownBrowserViews: () => {},
    exit: () => {},
  },
  actors: {
    /** The running-agents prompt. True to go ahead; a throw also goes ahead. */
    approve: fromPromise<boolean>(() => Promise.resolve(true)),
    closeBrowserSessions: fromPromise<void>(() => Promise.resolve()),
    finalizeTelemetry: fromPromise<void>(() => Promise.resolve()),
    stopServices: fromPromise<void>(() => Promise.resolve()),
  },
  delays: {
    browserSessionsClose: BROWSER_SESSIONS_CLOSE_MS,
    /** Set per app from what the slowest service allows itself. */
    teardown: 10_000,
  },
  types: {
    context: {} as { quitAfterApproval: boolean },
    events: {} as { type: "approvalRequested" } | { type: "quitRequested" },
  },
}).createMachine({
  context: { quitAfterApproval: false },
  id: "quit",
  initial: "idle",
  states: {
    idle: {
      entry: assign({ quitAfterApproval: false }),
      on: {
        approvalRequested: "approving",
        quitRequested: {
          actions: assign({ quitAfterApproval: true }),
          target: "approving",
        },
      },
    },
    approving: {
      invoke: {
        onDone: [
          { guard: ({ event }) => event.output, target: "approved" },
          {
            // Canceling has to leave the user somewhere. A quit may have
            // started from a window close, and outside macOS a process whose
            // last window is gone can't be reached again at all.
            actions: {
              type: "reveal",
            },
            guard: ({ context }) => context.quitAfterApproval,
            target: "idle",
          },
          { target: "idle" },
        ],
        // Fail open, matching the running-agent count: a prompt that can't be
        // answered must not strand the quit half-done.
        onError: "approved",
        src: "approve",
      },
      on: {
        quitRequested: { actions: assign({ quitAfterApproval: true }) },
      },
    },
    approved: {
      always: {
        guard: ({ context }) => context.quitAfterApproval,
        target: "tearingDown",
      },
      on: { quitRequested: "tearingDown" },
      tags: ["approved"],
    },
    tearingDown: {
      // Teardown runs to `app.exit`, which logs nothing on its way out, so each
      // stage announces itself: a quit that never finishes is otherwise
      // indistinguishable from one that did, and the log is all there is.
      after: { teardown: "exiting" },
      entry: { params: { stage: "started" }, type: "announce" },
      onDone: {
        actions: {
          params: { stage: "services and telemetry settled" },
          type: "announce",
        },
        target: "exiting",
      },
      states: {
        steps: {
          initial: "closingBrowserSessions",
          states: {
            closingBrowserSessions: {
              after: {
                browserSessionsClose: {
                  actions: "reportBrowserSessionsTimeout",
                  target: "stoppingServices",
                },
              },
              invoke: {
                onDone: "stoppingServices",
                onError: "stoppingServices",
                src: "closeBrowserSessions",
              },
            },
            stoppingServices: {
              entry: [
                {
                  params: { stage: "tearing down browser views" },
                  type: "announce",
                },
                "teardownBrowserViews",
              ],
              invoke: {
                onDone: "stopped",
                onError: "stopped",
                src: "stopServices",
              },
            },
            stopped: { type: "final" },
          },
        },
        // Started with the teardown so it overlaps the rest instead of adding
        // to it.
        telemetry: {
          initial: "flushing",
          states: {
            flushing: {
              invoke: {
                onDone: "flushed",
                onError: "flushed",
                src: "finalizeTelemetry",
              },
            },
            flushed: { type: "final" },
          },
        },
      },
      tags: ["approved"],
      type: "parallel",
    },
    exiting: {
      entry: [{ params: { stage: "exiting" }, type: "announce" }, "exit"],
      tags: ["approved"],
      type: "final",
    },
  },
});
