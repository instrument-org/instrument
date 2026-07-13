import { describe, expect, it } from "vitest";

import { steppedZoom } from "./zoom";

// Browser guest range (matches desktop Chrome).
const BROWSER = { max: 5, min: 0.25 };
// App-window UI range.
const APP = { max: 2, min: 0.5 };

describe("steppedZoom", () => {
  it.each([
    // Stepping in walks up Chrome's ladder from 100%.
    { direction: "in", expected: 1.1, factor: 1, range: BROWSER },
    { direction: "in", expected: 1.25, factor: 1.1, range: BROWSER },
    { direction: "in", expected: 2.5, factor: 2, range: BROWSER },
    // Stepping out walks down through the dialed-back low end.
    { direction: "out", expected: 0.9, factor: 1, range: BROWSER },
    { direction: "out", expected: 0.25, factor: 0.33, range: BROWSER },
    // Ends clamp at min / max.
    { direction: "in", expected: 5, factor: 5, range: BROWSER },
    { direction: "out", expected: 0.25, factor: 0.25, range: BROWSER },
    // An off-rung factor snaps to the neighboring rung in each direction.
    { direction: "in", expected: 1.5, factor: 1.33, range: BROWSER },
    { direction: "out", expected: 1.25, factor: 1.33, range: BROWSER },
    // The app range excludes rungs above 200% / below 50%, so it clamps there.
    { direction: "in", expected: 1.1, factor: 1, range: APP },
    { direction: "in", expected: 2, factor: 2, range: APP },
    { direction: "out", expected: 0.5, factor: 0.5, range: APP },
  ] as const)(
    "$direction from $factor within [$range.min, $range.max] -> $expected",
    ({ direction, expected, factor, range }) => {
      expect(steppedZoom({ direction, factor, ...range })).toBe(expected);
    },
  );
});
