import { assertEvent, assign, fromCallback, setup } from "xstate";

// Time spent traversing the gap between two frames during user-driven
// auto-playback. Higher values feel slower / more cinematic.
const FRAME_DURATION_MS = 1200;

interface AgentBrowserPlayerContext {
  // Stashed at init only to drive the Initializing guard; not updated after that.
  isStreaming: boolean;
  lastFrameIndex: number;
  playhead: number;
}

type AgentBrowserPlayerEvent =
  | { deltaMs: number; type: "tick" }
  | {
      lastFrameIndex: number;
      type: "frames.changed";
    }
  | { type: "pause" }
  | { type: "play" }
  | { type: "scrub"; value: number };

export const agentBrowserPlayerMachine = setup({
  actions: {
    advancePlayhead: assign(({ context, event }) => {
      assertEvent(event, "tick");
      const delta = event.deltaMs / FRAME_DURATION_MS;
      return {
        playhead: Math.min(context.playhead + delta, context.lastFrameIndex),
      };
    }),
    rewindIfAtEnd: assign(({ context }) => {
      if (context.playhead >= context.lastFrameIndex) {
        return { playhead: 0 };
      }
      return {};
    }),
    setPlayheadFromScrub: assign(({ context, event }) => {
      assertEvent(event, "scrub");
      // Clamp to real frames - the ghost zone is a render-only concept that
      // the user shouldn't be able to park inside.
      return {
        playhead: Math.max(0, Math.min(event.value, context.lastFrameIndex)),
      };
    }),
    snapPlayheadToLatest: assign(({ context }) => ({
      playhead: context.lastFrameIndex,
    })),
    updateFrameInfo: assign(({ event }) => {
      assertEvent(event, "frames.changed");
      return {
        lastFrameIndex: event.lastFrameIndex,
      };
    }),
  },
  actors: {
    playbackTicker: fromCallback<AgentBrowserPlayerEvent>(({ sendBack }) => {
      // rAF (rather than setInterval) keeps the playhead aligned to display
      // frames so the slider thumb glides smoothly instead of stepping at
      // a coarser interval. The rAF loop is fully encapsulated here - the
      // rest of the machine just consumes `tick` events.
      let last = performance.now();
      let rafId = 0;
      const tick = (now: number) => {
        const deltaMs = now - last;
        last = now;
        sendBack({ deltaMs, type: "tick" });
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(rafId);
      };
    }),
  },
  guards: {
    hasMultipleFrames: ({ context }) => context.lastFrameIndex > 0,
    isLiveSession: ({ context }) => context.isStreaming,
    reachedEnd: ({ context }) => context.playhead >= context.lastFrameIndex,
  },
  types: {
    context: {} as AgentBrowserPlayerContext,
    events: {} as AgentBrowserPlayerEvent,
    input: {} as { isStreaming: boolean; lastFrameIndex: number },
    tags: {} as "playing",
  },
}).createMachine({
  context: ({ input }) => ({
    isStreaming: input.isStreaming,
    lastFrameIndex: input.lastFrameIndex,
    playhead: input.lastFrameIndex,
  }),
  id: "agentBrowserPlayer",
  initial: "Initializing",
  states: {
    Following: {
      on: {
        "frames.changed": {
          actions: ["updateFrameInfo", "snapPlayheadToLatest"],
        },
        pause: { target: "UserControlled.Paused" },
        play: {
          actions: ["rewindIfAtEnd"],
          target: "UserControlled.Playing",
        },
        scrub: {
          actions: ["setPlayheadFromScrub"],
          target: "UserControlled.Paused",
        },
      },
    },
    // Transient: pick the right starting state based on input. Active
    // streaming sessions live-follow. Finished sessions auto-play from the
    // start so the user immediately sees what happened. Single-frame sessions
    // just sit on that frame.
    Initializing: {
      always: [
        { guard: "isLiveSession", target: "Following" },
        {
          actions: assign({ playhead: 0 }),
          guard: "hasMultipleFrames",
          target: "UserControlled.Playing",
        },
        { target: "Following" },
      ],
    },
    UserControlled: {
      initial: "Paused",
      on: {
        "frames.changed": { actions: ["updateFrameInfo"] },
      },
      states: {
        Paused: {
          on: {
            play: {
              actions: ["rewindIfAtEnd"],
              target: "Playing",
            },
            scrub: { actions: ["setPlayheadFromScrub"] },
          },
        },
        Playing: {
          invoke: { src: "playbackTicker" },
          on: {
            pause: { target: "Paused" },
            scrub: { actions: ["setPlayheadFromScrub"] },
            tick: [
              {
                actions: ["advancePlayhead"],
                guard: "reachedEnd",
                target: "Paused",
              },
              { actions: ["advancePlayhead"] },
            ],
          },
          tags: ["playing"],
        },
      },
    },
  },
});
