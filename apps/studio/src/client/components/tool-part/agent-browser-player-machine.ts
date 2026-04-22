import { assertEvent, assign, fromCallback, not, setup } from "xstate";

// Time spent traversing the gap between two frames during user-driven
// auto-playback. Higher values feel slower / more cinematic.
const FRAME_DURATION_MS = 1200;
// Per-second exponential approach factor used while creeping the playhead
// into the ghost slot during streaming. Low so the thumb visibly slows as
// it approaches and never quite arrives.
const STREAM_APPROACH_PER_S = 0.6;

interface AgentBrowserPlayerContext {
  lastFrameIndex: number;
  playhead: number;
  // The position the playhead should creep toward while streaming. Usually
  // `lastFrameIndex + 1` (the ghost slot) when something is pending, else
  // equal to `lastFrameIndex`.
  streamTarget: number;
}

type AgentBrowserPlayerEvent =
  | { deltaMs: number; type: "tick" }
  | {
      lastFrameIndex: number;
      streamTarget: number;
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
    creepPlayheadTowardStream: assign(({ context, event }) => {
      assertEvent(event, "tick");
      const distance = context.streamTarget - context.playhead;
      if (distance <= 0) {
        return {};
      }
      const dtSec = Math.min(event.deltaMs / 1000, 0.1);
      const factor = 1 - Math.exp(-STREAM_APPROACH_PER_S * dtSec);
      return { playhead: context.playhead + distance * factor };
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
        streamTarget: event.streamTarget,
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
    isStreaming: ({ context }) => context.streamTarget > context.lastFrameIndex,
    reachedEnd: ({ context }) => context.playhead >= context.lastFrameIndex,
  },
  types: {
    context: {} as AgentBrowserPlayerContext,
    events: {} as AgentBrowserPlayerEvent,
    input: {} as { lastFrameIndex: number; streamTarget: number },
    tags: {} as "playing",
  },
}).createMachine({
  context: ({ input }) => ({
    lastFrameIndex: input.lastFrameIndex,
    playhead: input.lastFrameIndex,
    streamTarget: input.streamTarget,
  }),
  id: "agentBrowserPlayer",
  initial: "Initializing",
  states: {
    // Transient: pick the right starting state based on input. Streaming
    // sessions live-follow; finished sessions auto-play from the start so
    // the user immediately sees what happened. Single-frame sessions just
    // sit on that frame.
    Following: {
      initial: "Settled",
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
      states: {
        // No active session: parked on the latest real frame, no ticker.
        Settled: {
          always: { guard: "isStreaming", target: "Streaming" },
        },
        // Agent is still producing frames. The ticker is running and the
        // playhead is asymptotically creeping into the ghost slot to signal
        // "more is coming."
        Streaming: {
          always: { guard: not("isStreaming"), target: "Settled" },
          invoke: { src: "playbackTicker" },
          on: {
            tick: { actions: ["creepPlayheadTowardStream"] },
          },
          tags: ["playing"],
        },
      },
    },
    Initializing: {
      always: [
        { guard: "isStreaming", target: "Following" },
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
        scrub: {
          actions: ["setPlayheadFromScrub"],
          target: ".Paused",
        },
      },
      states: {
        Paused: {
          on: {
            play: {
              actions: ["rewindIfAtEnd"],
              target: "Playing",
            },
          },
        },
        Playing: {
          invoke: { src: "playbackTicker" },
          on: {
            pause: { target: "Paused" },
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
