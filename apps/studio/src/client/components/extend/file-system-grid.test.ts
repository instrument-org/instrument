import { describe, expect, it } from "vitest";

import { type ListingDirection } from "./file-system-keys";
import { gridNeighbor } from "./file-system-grid";

/** 13 tiles named 01 to 13, `columns` to a row. */
function grid(columns: number) {
  const entries = Array.from({ length: 13 }, (_, index) => ({
    path: String(index + 1).padStart(2, "0"),
  }));
  const placeOf = (path: string) => {
    const index = Number(path) - 1;
    return {
      left: (index % columns) * 100,
      top: Math.floor(index / columns) * 100,
    };
  };
  return { entries, placeOf };
}

function go(
  columns: number,
  current: null | string,
  direction: ListingDirection,
  byPlace = true,
) {
  return (
    gridNeighbor({ ...grid(columns), byPlace, current, direction })?.path ??
    null
  );
}

describe("gridNeighbor by place", () => {
  it.each([
    // Measured on 6 columns: 01-06, 07-12, 13.
    [6, "06", "right", null],
    [6, "07", "left", null],
    [6, "13", "right", "08"],
    [6, "13", "left", null],
    [6, "08", "down", "13"],
    [6, "09", "down", null],
    [6, "12", "down", null],
    [6, "01", "down", "07"],
    [6, "07", "up", "01"],
    [6, "02", "up", null],
    [6, "13", "down", null],
    // Measured on 7 columns: 01-07, 08-13.
    [7, "13", "right", "07"],
    [7, "13", "left", "12"],
    [7, "07", "down", "13"],
    [7, "08", "left", null],
    // Nothing selected.
    [6, null, "right", "01"],
    [6, null, "down", "01"],
    [6, null, "up", "13"],
    [6, null, "left", "12"],
  ] as const)("on %i columns, %s %s reaches %s", (columns, from, way, to) => {
    expect(go(columns, from, way)).toBe(to);
  });
});

describe("gridNeighbor in order across", () => {
  it.each([
    [8, "08", "right", "09"],
    [8, "09", "left", "08"],
    [8, "13", "right", null],
    [8, "08", "down", "13"],
    [8, null, "up", "01"],
    [8, null, "left", "01"],
  ] as const)("on %i columns, %s %s reaches %s", (columns, from, way, to) => {
    expect(go(columns, from, way, false)).toBe(to);
  });
});
