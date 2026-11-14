import { describe, expect, it } from "vitest";

import { leftWidthAt, shareAt } from "./side-widths";

describe("leftWidthAt", () => {
  it.each([
    { share: 0.5, room: 1000, width: 500 },
    { share: 0.69, room: 1556, width: 1073.64 },
    // Kept in a wider window: the right side stops at its narrowest.
    { share: 0.69, room: 896, width: 456 },
    { share: 0.2, room: 896, width: 440 },
    // The row never lays out below two floors; before it is measured, nothing stands.
    { share: 0.69, room: 0, width: 0 },
  ])("lays out $share of $room as $width", ({ share, room, width }) => {
    expect(leftWidthAt(share, room)).toBeCloseTo(width);
  });
});

describe("shareAt", () => {
  it.each([
    { width: 505, room: 1000, share: 0.5 },
    { width: 1300, room: 2000, share: 0.65 },
    { width: 900, room: 1000, share: 0.56 },
    { width: 100, room: 1000, share: 0.44 },
    { width: 300, room: 0, share: 0.5 },
  ])(
    "keeps $share for a gutter dragged to $width of $room",
    ({ width, room, share }) => {
      expect(shareAt(width, room)).toBeCloseTo(share);
    },
  );
});
