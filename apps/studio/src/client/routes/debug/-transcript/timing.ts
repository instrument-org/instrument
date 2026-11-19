import { type Frame } from "./frames";

/**
 * How a run arrives over time, so replay can play it at a stream's own pace
 * rather than a step at a time: how big the pieces of text are, how fast they
 * come, how unevenly, and how long the gaps between steps are.
 */
export interface ArrivalProfile {
  /** Words per streamed piece of text. */
  chunkWords: number;
  /** How fast text arrives while it streams. */
  charsPerSecond: number;
  /** How long a step that is not text takes to land: a call, a note. */
  stepMs: number;
  /** How long a message the person sends takes to land. */
  userMs: number;
  /** 0 is a metronome, 1 has pieces arriving from at once to twice as late. */
  jitter: number;
  /** A pause in the stream this often, in pieces, as networks and providers do. */
  stallEvery?: number;
  stallMs?: number;
  id: string;
  name: string;
}

export const PROFILES: ArrivalProfile[] = [
  {
    charsPerSecond: 350,
    chunkWords: 3,
    id: "even",
    jitter: 0.15,
    name: "Even",
    stepMs: 700,
    userMs: 900,
  },
  {
    charsPerSecond: 600,
    chunkWords: 18,
    id: "bursty",
    jitter: 0.9,
    name: "Bursty",
    stallEvery: 5,
    stallMs: 900,
    stepMs: 600,
    userMs: 900,
  },
  {
    charsPerSecond: 70,
    chunkWords: 2,
    id: "slow",
    jitter: 0.4,
    name: "Slow model",
    stepMs: 1400,
    userMs: 900,
  },
  {
    charsPerSecond: 1600,
    chunkWords: 10,
    id: "fast",
    jitter: 0.3,
    name: "Fast model",
    stepMs: 350,
    userMs: 900,
  },
];

/** How fast replay plays a timed run, as a multiple of its own pace. */
export const RATES = [0.25, 0.5, 1, 2];

/**
 * When each frame lands, in ms from the first, for a run arriving as
 * `profile` says. Seeded, so the same run plays the same way every time.
 */
export function frameTimes(
  frames: readonly Frame[],
  profile: ArrivalProfile,
  seed = 1,
): number[] {
  const random = mulberry32(seed);
  const times: number[] = [];
  let at = 0;
  let pieces = 0;
  let previousLength = 0;
  for (const frame of frames) {
    const length = streamedLength(frame);
    const grew = Math.max(0, length - previousLength);
    previousLength = length;
    if (times.length > 0) {
      const isText =
        (frame.mark.kind === "prose" || frame.mark.kind === "reasoning") &&
        frame.mark.phase === "streaming";
      let wait =
        frame.mark.kind === "user"
          ? profile.userMs
          : isText
            ? (grew * 1000) / profile.charsPerSecond
            : frame.mark.phase === "done" && grew === 0
              ? 30
              : profile.stepMs;
      wait *= 1 + (random() * 2 - 1) * profile.jitter;
      if (isText) {
        pieces += 1;
        if (profile.stallEvery && pieces % profile.stallEvery === 0) {
          wait += profile.stallMs ?? 0;
        }
      }
      at += Math.max(8, wait);
    }
    times.push(Math.round(at));
  }
  return times;
}

/** The longest a recorded run waits between two frames, so a long call does not stall replay. */
const MAX_RECORDED_GAP_MS = 4000;

/**
 * When each frame of a real chat landed, in ms from the first, as it was
 * recorded, or none when the frames carry no times. A wait longer than a few
 * seconds is cut short.
 */
export function recordedTimes(frames: readonly Frame[]): number[] | undefined {
  const times: number[] = [];
  let at = 0;
  let previous: number | undefined;
  for (const frame of frames) {
    if (frame.at === undefined) {
      return undefined;
    }
    if (previous !== undefined) {
      at += Math.min(Math.max(frame.at - previous, 1), MAX_RECORDED_GAP_MS);
    }
    previous = frame.at;
    times.push(Math.round(at));
  }
  return times;
}

/** The last frame landed by `ms`. */
export function frameAt(times: readonly number[], ms: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((times[middle] ?? Infinity) <= ms) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** All the text and thinking in a frame, which is what grows as it streams. */
function streamedLength(frame: Frame): number {
  let length = 0;
  for (const message of frame.messages) {
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        length += part.text.length;
      }
    }
  }
  return length;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}
