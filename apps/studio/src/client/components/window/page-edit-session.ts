import { assign, fromCallback, setup } from "xstate";

/** How long to wait for a guest to attach before looking again, and how many looks. */
const ATTACH_RETRY_MS = 250;
export const ATTACH_RETRIES = 40;

/** How long the picture stays over a reloaded page once its editor says hello. */
export const COVER_HOLD_MS = 80;

/** How long a picture may stand over a reload that never reports back. */
export const COVER_TIMEOUT_MS = 6000;

/** What serving the guest reports back to the session. */
export type PageEditServeEvent =
  | { cover: string; type: "coverCaptured" }
  | { type: "editorFailed" }
  | { type: "guestReady" };

/**
 * One page tab's Edit session with its guest.
 *
 * Two parts run side by side. The guest part looks for the attached guest,
 * again every so often for a while, and once there is one serves the editor
 * in it until the session stops. The cover part holds a picture of the page
 * over a reload: from the capture until the reloaded editor says hello (and a
 * moment after, so its first paint is under the picture), until the editor
 * fails, or until a reload that never reports back has stood long enough.
 *
 * Stopping the actor ends both, timers included.
 */
export const pageEditSessionMachine = setup({
  actors: {
    /** The protocol with the attached guest, from its first load to its stop. */
    serve: fromCallback<{ type: "none" }, void, PageEditServeEvent>(() => {}),
  },
  delays: {
    attachRetry: ATTACH_RETRY_MS,
    coverHold: COVER_HOLD_MS,
    coverTimeout: COVER_TIMEOUT_MS,
  },
  guards: {
    /** Whether the tab's guest is attached and can be served. */
    hasGuest: () => false,
  },
  types: {
    context: {} as { attempt: number; cover: null | string },
    events: {} as PageEditServeEvent,
  },
}).createMachine({
  context: { attempt: 0, cover: null },
  id: "pageEditSession",
  states: {
    cover: {
      initial: "none",
      on: {
        coverCaptured: {
          actions: assign({ cover: ({ event }) => event.cover }),
          target: ".held",
        },
      },
      states: {
        none: {
          entry: assign({ cover: null }),
        },
        held: {
          after: { coverTimeout: "none" },
          on: {
            editorFailed: "none",
            guestReady: "releasing",
          },
        },
        releasing: {
          after: { coverHold: "none" },
        },
      },
    },
    guest: {
      initial: "attaching",
      states: {
        attaching: {
          after: {
            attachRetry: {
              actions: assign({
                attempt: ({ context }) => context.attempt + 1,
              }),
              reenter: true,
              target: "attaching",
            },
          },
          always: [
            { guard: "hasGuest", target: "serving" },
            {
              guard: ({ context }) => context.attempt >= ATTACH_RETRIES,
              target: "unattached",
            },
          ],
        },
        serving: {
          invoke: { src: "serve" },
        },
        unattached: {},
      },
    },
  },
  type: "parallel",
});
