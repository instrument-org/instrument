import { describe, expect, it } from "vitest";

import { buildFrames } from "./frames";
import { frameAt, frameTimes, PROFILES } from "./timing";

const SCRIPT = [
  { kind: "user" as const, parts: [], text: "Compare the billing screenshots" },
  {
    kind: "prose" as const,
    text: "The billing screens match the October run, and two of them changed since then in small ways.",
  },
];

describe("frameTimes", () => {
  it.each(PROFILES.map((profile) => [profile.id, profile] as const))(
    "lands every %s frame after the one before",
    (_id, profile) => {
      const frames = buildFrames(SCRIPT, 0, profile.chunkWords);
      const times = frameTimes(frames, profile);
      expect(times).toHaveLength(frames.length);
      expect(times[0]).toBe(0);
      for (let at = 1; at < times.length; at += 1) {
        expect(times[at]).toBeGreaterThan(times[at - 1] ?? 0);
      }
    },
  );

  it("plays the same way for the same seed, and another way for another", () => {
    const profile = PROFILES.find((entry) => entry.id === "bursty");
    if (!profile) {
      throw new Error("no bursty profile");
    }
    const frames = buildFrames(SCRIPT, 0, profile.chunkWords);
    expect(frameTimes(frames, profile, 3)).toEqual(
      frameTimes(frames, profile, 3),
    );
    expect(frameTimes(frames, profile, 3)).not.toEqual(
      frameTimes(frames, profile, 4),
    );
  });

  it("streams text in smaller pieces for a profile that asks for them", () => {
    expect(buildFrames(SCRIPT, 0, 2).length).toBeGreaterThan(
      buildFrames(SCRIPT, 0).length,
    );
  });
});

it.each([
  [0, 0],
  [99, 0],
  [100, 1],
  [250, 1],
  [300, 2],
  [9999, 2],
])("puts frame at %i ms as %i", (ms, frame) => {
  expect(frameAt([0, 100, 300], ms)).toBe(frame);
});
