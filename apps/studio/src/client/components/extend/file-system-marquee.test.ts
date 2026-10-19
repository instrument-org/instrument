import { describe, expect, it } from "vitest";

import {
  boxBetween,
  edgeScrollSpeed,
  gridTileSpan,
  overlaps,
  stackHits,
} from "./file-system-marquee";

describe("the box a drag draws", () => {
  it("runs between the press and the pointer whichever way it went", () => {
    expect(boxBetween({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({
      height: 60,
      width: 40,
      x: 10,
      y: 40,
    });
  });

  it("touches a box whose edge it reaches", () => {
    const tile = { height: 10, width: 10, x: 10, y: 10 };
    expect(overlaps({ height: 5, width: 5, x: 5, y: 5 }, tile)).toBe(true);
    expect(overlaps({ height: 4, width: 4, x: 5, y: 5 }, tile)).toBe(false);
  });
});

describe("what a box crosses in a stack of rows", () => {
  it.each([
    // Rows 24 tall, flush: a box inside the third row takes it alone.
    { from: 50, to: 60, hits: [2] },
    // From the middle of the first to the middle of the fourth.
    { from: 12, to: 84, hits: [0, 1, 2, 3] },
    // Past the last row takes up to it.
    { from: 100, to: 500, hits: [4, 5] },
  ])("a box from $from to $to crosses $hits", ({ from, hits, to }) => {
    expect(
      stackHits({
        box: { height: to - from, width: 10, x: 0, y: from },
        count: 6,
        height: 24,
        stride: 24,
      }),
    ).toEqual(hits);
  });

  it("leaves the gap between rows set apart", () => {
    // Rows 28 tall, 29 apart, below 6 of padding: the gap after row 0 is 34.
    expect(
      stackHits({
        box: { height: 0, width: 10, x: 0, y: 34.5 },
        count: 3,
        height: 28,
        stride: 29,
        top: 6,
      }),
    ).toEqual([]);
  });
});

describe("where a tile stands in the grid", () => {
  it("centers the glyph's width in each track", () => {
    // 3 tracks of 100 across 308 with gaps of 4.
    expect(
      [0, 1, 2].map((column) =>
        gridTileSpan({
          column,
          columnCount: 3,
          gap: 4,
          tileWidth: 80,
          width: 308,
        }),
      ),
    ).toEqual([
      { width: 80, x: 10 },
      { width: 80, x: 114 },
      { width: 80, x: 218 },
    ]);
  });
});

describe("scrolling under a pointer held at an edge", () => {
  it.each([
    { pointer: 300, speed: 0 },
    { pointer: 110, speed: -7 },
    { pointer: 0, speed: -24 },
    { pointer: 590, speed: 7 },
  ])("at $pointer it scrolls $speed", ({ pointer, speed }) => {
    expect(edgeScrollSpeed({ bottom: 600, pointer, top: 100 })).toBe(speed);
  });
});
