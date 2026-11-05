import { type TabId } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import {
  boundsUnderPointer,
  carryView,
  dressesAtStart,
  landsBy,
  mergeFloats,
  phaseAt,
  placeOnWindow,
  whatGoes,
} from "./tab-carry-rules";

describe("what goes with the pointer", () => {
  const usual = {
    canPlace: true,
    isFullScreen: false,
    isOnlyTab: false,
    isPageUsedBehind: false,
    isTabPageUsed: false,
  };

  it.each([
    ["nothing is at stake", {}, "window"],
    ["the tab's own page is used", { isTabPageUsed: true }, "window"],
    ["a used page stays behind", { isPageUsedBehind: true }, "tab"],
    [
      "both sides have a used page",
      { isPageUsedBehind: true, isTabPageUsed: true },
      "window",
    ],
    ["the window is full screen", { isFullScreen: true }, "tab"],
    ["windows cannot be placed", { canPlace: false }, "tab"],
    [
      "it is the window's only tab",
      { canPlace: false, isOnlyTab: true },
      "window",
    ],
  ] as const)("when %s", (_case, facts, goes) => {
    expect(whatGoes({ ...usual, ...facts })).toBe(goes);
  });
});

describe("when the spare window gets its tabs", () => {
  const usual = {
    goes: "window",
    hasFloats: false,
    isSpareUp: true,
    neighborPages: [],
    pages: [],
  } as const;

  it.each([
    ["a screen comes up next door", {}, true],
    ["a page comes up next door", { neighborPages: ["page"] }, false],
    ["floats would go with the tabs", { hasFloats: true }, false],
    ["the tab going has no page", { goes: "tab" }, true],
    ["the tab going has a page", { goes: "tab", pages: ["page"] }, false],
    [
      "it has only just opened, whatever comes up",
      { hasFloats: true, isSpareUp: false, neighborPages: ["page"] },
      true,
    ],
  ] as const)("when %s", (_case, facts, isAtStart) => {
    expect(dressesAtStart({ ...usual, ...facts })).toBe(isAtStart);
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
    ["window", false, false, "takingStrip"],
    ["window", true, false, "takingStrip"],
    ["window", false, true, "joining"],
    ["window", true, true, "takingStrip"],
    ["tab", true, false, "joining"],
  ] as const)(
    "%s going, tab's page used %s, target's %s",
    (goes, isTabPageUsed, isTargetPageUsed, by) => {
      expect(landsBy({ goes, isTabPageUsed, isTargetPageUsed })).toBe(by);
    },
  );
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
  const free = { isPlaced: false, kind: "free" };

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

describe("what a window's strip shows", () => {
  const usual = {
    carried: "from",
    docked: () => ({ clientX: 5, tabs: [] }),
    goes: "window",
    heldId: "held" as TabId,
    spare: "spare",
  } as const;
  const free = { isPlaced: true, kind: "free" } as const;
  const docked = { kind: "docked", window: "other" } as const;

  it.each([
    [
      "on its row, the pressed window",
      { kind: "row" },
      "from",
      { kind: "row" },
    ],
    [
      "on its row, the spare beneath",
      { kind: "row" },
      "spare",
      { kind: "beneath" },
    ],
    [
      "free, the window carried",
      free,
      "from",
      { heldId: "held", kind: "free" },
    ],
    ["free, the spare it uncovers", free, "spare", { kind: "row" }],
    [
      "docked, the window carried",
      docked,
      "from",
      { clientX: 5, heldId: "held", kind: "docked", tabs: [] },
    ],
    ["docked, the spare", docked, "spare", { kind: "row" }],
  ] as const)("%s", (_case, phase, window, view) => {
    expect(carryView({ ...usual, phase, window })).toEqual(view);
  });

  it("with the tab rebuilt in the spare, draws it there and leaves the pressed window alone", () => {
    const rebuilt = { ...usual, carried: "spare", goes: "tab" } as const;
    expect(carryView({ ...rebuilt, phase: free, window: "spare" })).toEqual({
      kind: "row",
    });
    expect(carryView({ ...rebuilt, phase: docked, window: "spare" })).toEqual({
      clientX: 5,
      heldId: "held",
      kind: "docked",
      tabs: [],
    });
    expect(carryView({ ...rebuilt, phase: docked, window: "from" })).toEqual({
      kind: "row",
    });
  });
});
