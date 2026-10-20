import { describe, expect, it } from "vitest";

import {
  boxBetween,
  edgeScrollSpeed,
  gridTileSpan,
  overlaps,
  runHits,
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

describe("the run of rows a drag up or down takes", () => {
  it.each([
    // Rows 24 apart: pressed in the third, dragged into the fifth.
    { from: 50, to: 100, hits: [2, 3, 4] },
    // Dragged up from the fifth to the second.
    { from: 100, to: 30, hits: [1, 2, 3, 4] },
    // Pressed past the last row, it runs from the last.
    { from: 500, to: 80, hits: [3, 4, 5] },
    // Held above the first, it runs to the first.
    { from: 60, to: -40, hits: [0, 1, 2] },
  ])("from $from to $to takes $hits", ({ from, hits, to }) => {
    expect(runHits({ count: 6, from, stride: 24, to })).toEqual(hits);
  });

  it("takes nothing from an empty stack", () => {
    expect(runHits({ count: 0, from: 10, stride: 24, to: 90 })).toEqual([]);
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
