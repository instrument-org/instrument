import { type ClaudeCodeSignIn } from "@instrument-org/ai-gateway";
import { assign, fromPromise, setup, stateIn } from "xstate";

/**
 * Our copy of Claude Code's sign-in, from the press of Continue to the
 * process ending.
 *
 * - `idle`: no sign-in under way.
 * - `waiting`: Claude Code's sign-in process is running, waiting on the
 *   browser or on a code pasted from another device (`waiting.pasted`). It
 *   ends on its own after `signInTimeout`.
 * - `replacing`: a pasted code Anthropic refused ended the process, and only
 *   the process that made a link can redeem its codes, so a new one is being
 *   started with a new link; the person stays on the code field rather than
 *   starting over.
 *
 * The machine starts no process for a press of Continue: the caller starts it
 * and hands it over in `started`, since the caller opens its page and answers
 * whether it could.
 */
export const claudeSignInMachine = setup({
  actions: {
    cancelSignIn: (_, _params: { signIn: ClaudeCodeSignIn | undefined }) => {},
    /** The sign-in ended, however it did: read the account again. */
    ended: () => {},
    /** Claude Code stored a sign-in: bring the app back to the front. */
    landed: () => {},
  },
  actors: {
    completion: fromPromise<void, { signIn: ClaudeCodeSignIn }>(
      ({ input }) => input.signIn.completion,
    ),
    restart: fromPromise<ClaudeCodeSignIn, { executablePath: string }>(() =>
      Promise.reject(new Error("restart is provided by the caller")),
    ),
  },
  guards: {
    /** A code was pasted into the process that ended, which a refused code ends. */
    codeWasPasted: stateIn({ waiting: "pasted" }),
  },
  delays: {
    signInTimeout: 15 * 60 * 1000,
  },
  types: {
    context: {} as {
      executablePath: string | undefined;
      /** The process waiting, or the one a refused code ended while it is replaced. */
      signIn: ClaudeCodeSignIn | undefined;
    },
    events: {} as
      /** The person gave up in the app. */
      | { type: "cancel" }
      /** A code from another device was handed to the waiting process. */
      | { type: "codePasted" }
      /** A new sign-in process started, replacing any under way. */
      | { executablePath: string; signIn: ClaudeCodeSignIn; type: "started" },
  },
}).createMachine({
  context: { executablePath: undefined, signIn: undefined },
  id: "claude-sign-in",
  initial: "idle",
  on: {
    started: {
      actions: [
        {
          params: ({ context }) => ({ signIn: context.signIn }),
          type: "cancelSignIn",
        },
        assign({
          executablePath: ({ event }) => event.executablePath,
          signIn: ({ event }) => event.signIn,
        }),
      ],
      reenter: true,
      target: ".waiting",
    },
  },
  states: {
    idle: {
      entry: assign({ signIn: undefined }),
    },
    replacing: {
      invoke: {
        input: ({ context }) => {
          if (context.executablePath === undefined) {
            throw new Error("Replacing a Claude sign-in that never started");
          }
          return { executablePath: context.executablePath };
        },
        onDone: {
          actions: assign({ signIn: ({ event }) => event.output }),
          target: "waiting",
        },
        onError: { actions: "ended", target: "idle" },
        src: "restart",
      },
      on: {
        cancel: { actions: "ended", target: "idle" },
      },
    },
    waiting: {
      after: {
        signInTimeout: {
          actions: [
            {
              params: ({ context }) => ({ signIn: context.signIn }),
              type: "cancelSignIn",
            },
            "ended",
          ],
          target: "idle",
        },
      },
      initial: "open",
      invoke: {
        input: ({ context }) => {
          if (!context.signIn) {
            throw new Error("Waiting on a Claude sign-in that never started");
          }
          return { signIn: context.signIn };
        },
        onDone: { actions: ["landed", "ended"], target: "idle" },
        onError: [
          { guard: "codeWasPasted", target: "replacing" },
          { actions: "ended", target: "idle" },
        ],
        src: "completion",
      },
      on: {
        cancel: {
          actions: [
            {
              params: ({ context }) => ({ signIn: context.signIn }),
              type: "cancelSignIn",
            },
            "ended",
          ],
          target: "idle",
        },
      },
      states: {
        open: {
          on: { codePasted: "pasted" },
        },
        pasted: {},
      },
    },
  },
});
