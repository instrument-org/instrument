import { describe, expect, it } from "vitest";

import { createLevelScale, rmsOf } from "./dictation-levels";

const FRAME_MS = 100;

/** Feeds a run of frames at a steady cadence and returns what each drew. */
function feed(
  scale: ReturnType<typeof createLevelScale>,
  rmsValues: number[],
  startMs = 0,
) {
  return rmsValues.map((rms, index) => scale(rms, startMs + index * FRAME_MS));
}

const round = (values: number[]) =>
  values.map((value) => Math.round(value * 100) / 100);

describe("createLevelScale", () => {
  it("draws nothing for the first frame, which has no interval to adapt over", () => {
    expect(createLevelScale()(0.5, 0)).toBe(0);
  });

  it("keeps digital silence at the floor", () => {
    const drawn = feed(
      createLevelScale(),
      Array.from({ length: 30 }, () => 0),
    );
    expect(Math.max(...drawn)).toBe(0);
  });

  it("draws quiet laptop speech as visible movement, not a flat line", () => {
    const scale = createLevelScale();
    // A quiet room, then speech around 0.01 linear (-40 dBFS).
    feed(
      scale,
      Array.from({ length: 30 }, () => 0.0005),
    );
    const speech = feed(
      scale,
      Array.from({ length: 30 }, (_, index) => (index % 2 ? 0.008 : 0.014)),
      3000,
    );
    expect(Math.max(...speech)).toBeGreaterThan(0.4);
  });

  it("does not pin steady speech to the top of the meter", () => {
    const scale = createLevelScale();
    feed(
      scale,
      Array.from({ length: 30 }, () => 0.001),
    );
    const drawn = feed(
      scale,
      Array.from({ length: 60 }, () => 0.05),
      3000,
    );
    expect(round(drawn.slice(-3))).toMatchInlineSnapshot(`
      [
        0.56,
        0.56,
        0.56,
      ]
    `);
  });

  it("does not adapt in one jump after a long pause between frames", () => {
    const steady = createLevelScale();
    const paused = createLevelScale();
    feed(steady, [0.01, 0.01]);
    feed(paused, [0.01, 0.01]);
    // One frame a minute later reads the same as one a moment later.
    expect(paused(0.2, 60_000)).toBeCloseTo(steady(0.2, 600), 5);
  });
});

describe("rmsOf", () => {
  it.each([
    [[0, 0, 0, 0], 0],
    [[1, -1, 1, -1], 1],
    [[0.5, -0.5], 0.5],
    [[], 0],
  ])("gives the RMS of %j as %d", (samples, rms) => {
    expect(rmsOf(new Float32Array(samples))).toBeCloseTo(rms);
  });
});
