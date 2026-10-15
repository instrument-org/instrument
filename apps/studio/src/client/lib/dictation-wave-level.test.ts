import { describe, expect, it } from "vitest";

import { createWaveLevel, rmsOf } from "./dictation-wave-level";

/** Feeds `level` a run of frames at one loudness and returns the last height. */
function settle(level: (rms: number) => number, rms: number, frames: number) {
  let height = 0;
  for (let index = 0; index < frames; index++) {
    height = level(rms);
  }
  return height;
}

describe("createWaveLevel", () => {
  it.each([
    ["a quiet room", 0.0005, 0.02],
    ["a loud room", 0.01, 0.4],
  ])("keeps steady noise low and speech high in %s", (_room, noise, voice) => {
    const level = createWaveLevel();
    const quiet = settle(level, noise, 400);
    const spoken = settle(level, voice, 10);
    expect(quiet).toBeLessThan(0.25);
    expect(spoken).toBeGreaterThan(0.7);
  });

  it("stays between 0 and 1 for silence and clipping", () => {
    const level = createWaveLevel();
    expect(level(0)).toBeGreaterThanOrEqual(0);
    expect(level(10)).toBeLessThanOrEqual(1);
  });
});

describe("rmsOf", () => {
  it("measures a frame's loudness", () => {
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsOf(new Float32Array())).toBe(0);
  });
});
