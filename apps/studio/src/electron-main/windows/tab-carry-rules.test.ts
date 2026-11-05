import { describe, expect, it } from "vitest";

import {
  boundsUnderPointer,
  landsBy,
  mergeFloats,
  phaseAt,
  placeOnWindow,
  whatGoes,
} from "./tab-carry-rules";

describe("what leaves as the tab is let go", () => {
  const usual = {
    canPlace: true,
    isFullScreen: false,
    isOnlyTab: false,
    isTabPageUsed: false,
  };

  it.each([
    ["nothing is at stake", {}, "tab"],
    ["the tab's own page is used", { isTabPageUsed: true }, "window"],
    [
      "the tab's own page is used, from full screen",
      { isFullScreen: true, isTabPageUsed: true },
      "tab",
    ],
    [
      "the tab's own page is used, where windows cannot be placed",
      { canPlace: false, isTabPageUsed: true },
      "tab",
    ],
    [
      "it is the window's only tab",
      { canPlace: false, isOnlyTab: true },
      "window",
    ],
  ] as const)("when %s", (_case, facts, goes) => {
    expect(whatGoes({ ...usual, ...facts })).toBe(goes);
  });
});

describe("two windows' floats as one", () => {
  it("keeps each once, the first window's first", () => {
    expect(
      mergeFloats(
        [
          { chatId: "a", kind: "chat" },
          { draftId: "b", kind: "draft" },
        ],
        [
          { chatId: "a", kind: "chat", placement: "bar" },
          { chatId: "c", kind: "chat" },
        ],
      ),
    ).toEqual([
      { chatId: "a", kind: "chat" },
      { draftId: "b", kind: "draft" },
      { chatId: "c", kind: "chat" },
    ]);
  });

  it("takes what is not a list of floats as none", () => {
    expect(mergeFloats(undefined, [{ chatId: "a" }])).toEqual([
      { chatId: "a" },
    ]);
  });
});

describe("who reopens as a tab lands on another window's strip", () => {
  it.each([
    ["window", false, "joining"],
    ["window", true, "takingStrip"],
    ["tab", false, "joining"],
    ["tab", true, "joining"],
  ] as const)("%s leaving, tab's page used %s", (goes, isTabPageUsed, by) => {
    expect(landsBy({ goes, isTabPageUsed })).toBe(by);
  });
});

describe("a window under the pointer", () => {
  const work = { height: 1000, width: 1600 };

  it("keeps the point it was grabbed at under the pointer", () => {
    expect(
      boundsUnderPointer(
        { x: 500, y: 300 },
        { x: 40, y: 20 },
        { height: 700, width: 1100 },
        work,
      ),
    ).toEqual({ height: 700, width: 1100, x: 460, y: 280 });
  });

  it("is no bigger than the screen it is on", () => {
    expect(
      boundsUnderPointer(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { height: 2000, width: 3000 },
        work,
      ),
    ).toEqual({ height: 1000, width: 1600, x: 0, y: 0 });
  });
});

const BAND = 40;
const left = {
  bounds: { height: 500, width: 500, x: 0, y: 0 },
  window: "left",
};
const right = {
  bounds: { height: 500, width: 500, x: 600, y: 0 },
  window: "right",
};
const over = {
  bounds: { height: 500, width: 500, x: 100, y: 100 },
  window: "over",
};

describe("where a window puts a point", () => {
  it.each([
    [{ x: 10, y: 10 }, "band"],
    [{ x: 10, y: 39 }, "band"],
    [{ x: 10, y: 40 }, "body"],
    [{ x: 499, y: 499 }, "body"],
    [{ x: 500, y: 10 }, "off"],
    [{ x: 10, y: -1 }, "off"],
  ] as const)("%o is %s", (point, place) => {
    expect(placeOnWindow(left.bounds, point, BAND)).toBe(place);
  });

  it.each([
    [{ x: 10, y: 63 }, "band"],
    [{ x: 10, y: 64 }, "body"],
    [{ x: 10, y: -24 }, "band"],
    [{ x: 10, y: -25 }, "off"],
    [{ x: -24, y: 10 }, "band"],
    [{ x: -25, y: 10 }, "off"],
    [{ x: 523, y: 10 }, "band"],
    [{ x: 524, y: 10 }, "off"],
  ] as const)("with reach, %o is %s", (point, place) => {
    expect(placeOnWindow(left.bounds, point, BAND, 24)).toBe(place);
  });
});

describe("where a tab off its row stands", () => {
  const at = (
    point: { x: number; y: number },
    windows: Parameters<typeof phaseAt<string>>[0]["windows"] = [left, right],
    from = left.window,
  ) => phaseAt({ bandHeight: BAND, from, point, windows });
  const free = { kind: "free" };

  it("is docked in the strip of another window", () => {
    expect(at({ x: 700, y: 20 })).toEqual({ kind: "docked", window: "right" });
  });

  it("is back on its row over its own strip", () => {
    expect(at({ x: 100, y: 20 })).toEqual({ kind: "row" });
  });

  it("stays in a strip a little past its edge only where it is held already", () => {
    const below = { x: 700, y: 50 };
    expect(at(below)).toEqual(free);
    expect(at(below, [left, { ...right, reach: 24 }])).toEqual({
      kind: "docked",
      window: "right",
    });
  });

  it("is free over nothing, and over the page of either window", () => {
    expect(at({ x: 550, y: 300 })).toEqual(free);
    expect(at({ x: 700, y: 300 })).toEqual(free);
    expect(at({ x: 100, y: 300 })).toEqual(free);
  });

  it("cannot reach a strip another window covers", () => {
    expect(at({ x: 150, y: 120 }, [over, left])).toEqual({
      kind: "docked",
      window: "over",
    });
    expect(at({ x: 150, y: 20 }, [over, left, right], "right")).toEqual({
      kind: "docked",
      window: "left",
    });
    expect(at({ x: 150, y: 200 }, [over, left, right], "right")).toEqual(free);
  });
});
