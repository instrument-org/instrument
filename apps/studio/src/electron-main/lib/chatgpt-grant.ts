import { assign, fromPromise, setup } from "xstate";

/** How one refresh of a grant's tokens ended. */
export type RefreshOutcome =
  /** The server would not refresh (the session ended elsewhere, or the token was spent); signing in again is required. */
  | "ended"
  /** A network or server failure; the tokens are kept for the next try. */
  | "failed"
  /** Not yet: the server's earliest refresh time has not come. */
  | "not-yet"
  /** New tokens, saved. */
  | "refreshed"
  /** A sign-in replaced the tokens while the refresh was out, and its answer was dropped: the grant holds the new ones. */
  | "replaced";

/**
 * One ChatGPT account's grant on this host, from a sign-in to a sign-out.
 *
 * - `signedOut`: known, with no tokens, its session ended or never begun.
 *   Signing in to it again reuses its registration.
 * - `awaitingCallback`: a sign-in to it is waiting on the browser.
 * - `active`: holding tokens, and refreshing them when they are due
 *   (`active.refreshing`), one refresh at a time since the refresh token
 *   rotates and two would spend it twice.
 * - `revoking` then `revoked`: signed out and forgotten. A sign-out asked
 *   while a refresh is out waits for it, so the token revoked is the current
 *   one rather than the one the refresh spent.
 *
 * The machine writes nothing itself: every write is an action or actor the
 * caller provides, and each goes through `saveUnlessReplaced`, so an answer
 * about tokens that were replaced while it was out is dropped rather than
 * written over the new ones.
 */
export const grantMachine = setup({
  actions: {
    /** Drops the tokens of a session the API refused, unless they were replaced since. */
    endSession: (_, _params: { accessToken: string }) => {},
  },
  actors: {
    refresh: fromPromise<RefreshOutcome, { id: string }>(() =>
      Promise.resolve("refreshed" as const),
    ),
    /** Forgets the grant and revokes its refresh token; answers whether the server confirmed. */
    revoke: fromPromise<{ revoked: boolean }, { id: string }>(() =>
      Promise.resolve({ revoked: true }),
    ),
  },
  delays: {
    /** Until the next refresh is due: computed from the tokens and the failures so far. */
    refreshDelay: 60_000,
  },
  guards: {
    /** Whether the grant holds a refresh token, for a sign-in that ended without one. */
    hasSession: () => false,
    /** Whether the access token is close enough to expiring to refresh now. */
    isDue: () => false,
  },
  types: {
    context: {} as {
      /** Refreshes that failed in a row, which the refresh delay backs off on. */
      failures: number;
      id: string;
      /** Whether the server confirmed the revocation, once revoked. */
      revoked: boolean;
      /** A sign-out asked while a refresh was out, done once it settles. */
      signOutAsked: boolean;
    },
    events: {} as
      /** A request or a check found the token due. */
      | { type: "refreshDue" }
      /** The API refused `accessToken`: the session ended elsewhere, unless the tokens were replaced since. */
      | { accessToken: string; type: "sessionRefused" }
      /** A sign-in to this grant saved new tokens. */
      | { type: "signedIn" }
      /** A sign-in to this grant ended without landing: canceled, declined, failed or replaced. */
      | { type: "signInEnded" }
      /** A sign-in to this grant opened in the browser. */
      | { type: "signInStarted" }
      | { type: "signOut" }
      /** The machine woke from a sleep its timers did not count. */
      | { type: "woke" },
    input: {} as { id: string },
    output: {} as { revoked: boolean },
  },
}).createMachine({
  context: ({ input }) => ({
    failures: 0,
    id: input.id,
    revoked: false,
    signOutAsked: false,
  }),
  id: "chatgpt-grant",
  initial: "choosing",
  output: ({ context }) => ({ revoked: context.revoked }),
  states: {
    active: {
      initial: "waiting",
      on: {
        sessionRefused: {
          actions: {
            params: ({ event }) => ({ accessToken: event.accessToken }),
            type: "endSession",
          },
          target: "signedOut",
        },
        signedIn: {
          actions: assign({ failures: 0 }),
          reenter: true,
          target: "active",
        },
        signOut: "revoking",
      },
      states: {
        refreshing: {
          invoke: {
            input: ({ context }) => ({ id: context.id }),
            onDone: [
              {
                guard: ({ context }) => context.signOutAsked,
                target: "#chatgpt-grant.revoking",
              },
              {
                guard: ({ event }) => event.output === "ended",
                target: "#chatgpt-grant.signedOut",
              },
              {
                actions: assign({
                  failures: ({ context }) => context.failures + 1,
                }),
                guard: ({ event }) => event.output === "failed",
                target: "waiting",
              },
              {
                actions: assign({
                  failures: ({ context, event }) =>
                    event.output === "not-yet" ? context.failures : 0,
                }),
                target: "waiting",
              },
            ],
            onError: [
              {
                guard: ({ context }) => context.signOutAsked,
                target: "#chatgpt-grant.revoking",
              },
              {
                actions: assign({
                  failures: ({ context }) => context.failures + 1,
                }),
                target: "waiting",
              },
            ],
            src: "refresh",
          },
          on: {
            // The refresh out spends the refresh token and brings back its
            // replacement, so the sign-out waits for it and revokes that.
            signOut: { actions: assign({ signOutAsked: true }) },
          },
        },
        waiting: {
          after: { refreshDelay: "refreshing" },
          on: {
            refreshDue: "refreshing",
            woke: [
              { guard: "isDue", target: "refreshing" },
              // Counted again from now: the timer's clock stopped in the sleep.
              { reenter: true, target: "waiting" },
            ],
          },
        },
      },
    },
    awaitingCallback: {
      on: {
        signedIn: "active",
        signInEnded: [
          { guard: "hasSession", target: "active" },
          { target: "signedOut" },
        ],
        signOut: "revoking",
      },
    },
    /** Where a grant read from the store starts: by whether it has a session. */
    choosing: {
      always: [
        { guard: "hasSession", target: "active" },
        { target: "signedOut" },
      ],
    },
    revoked: {
      type: "final",
    },
    revoking: {
      invoke: {
        input: ({ context }) => ({ id: context.id }),
        onDone: {
          actions: assign({ revoked: ({ event }) => event.output.revoked }),
          target: "revoked",
        },
        onError: "revoked",
        src: "revoke",
      },
    },
    signedOut: {
      on: {
        signedIn: "active",
        signInStarted: "awaitingCallback",
        signOut: "revoking",
      },
    },
  },
});
