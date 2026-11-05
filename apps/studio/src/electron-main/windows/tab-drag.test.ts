import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: {},
  screen: {},
  webContents: {},
}));
vi.mock("@/electron-main/windows/traffic-lights", () => ({}));
vi.mock("@/electron-main/browser-view/manager", () => ({}));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: {} }));
vi.mock("@/electron-main/stores/workspace/kept-state", () => ({}));
vi.mock("@/electron-main/stores/workspace/window-state", () => ({}));
vi.mock("@/electron-main/windows/app-window", () => ({}));
vi.mock("@/electron-main/windows/on-screen", () => ({}));

const {
  boundsUnderPointer,
  carryDestination,
  carryPhase,
  dressesAtStart,
  landsBy,
  mergeFloats,
  placeOnWindow,
  whatGoes,
} = await import("./tab-drag");

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
    floats: [],
    goes: "window",
    isSpareUp: true,
    neighborPages: [],
    pages: [],
  } as const;

  it.each([
    ["a screen comes up next door", {}, true],
    ["a page comes up next door", { neighborPages: ["page"] }, false],
    ["floats would go with the tabs", { floats: [{}] }, false],
    ["the tab going has no page", { goes: "tab" }, true],
    ["the tab going has a page", { goes: "tab", pages: ["page"] }, false],
    [
      "it has only just opened, whatever comes up",
      { floats: [{}], isSpareUp: false, neighborPages: ["page"] },
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

describe("where a dragged tab is", () => {
  it.each([
    [false, "new", undefined, { kind: "row" }],
    [false, "band", "other", { kind: "row" }],
    [true, "none", undefined, { kind: "row" }],
    [true, "new", undefined, { kind: "free" }],
    [true, "band", "other", { kind: "docked", window: "other" }],
  ] as const)("off its row %s, over %s %s", (isOff, place, window, phase) => {
    expect(carryPhase(isOff, place, window)).toEqual(phase);
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
const left = { bounds: { height: 500, width: 500, x: 0, y: 0 } };
const right = { bounds: { height: 500, width: 500, x: 600, y: 0 } };
const over = { bounds: { height: 500, width: 500, x: 100, y: 100 } };

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

describe("where a tab let go lands", () => {
  const land = (
    point: undefined | { x: number; y: number },
    windows = [left, right],
    { canceled = false, from = left } = {},
  ) => carryDestination({ bandHeight: BAND, canceled, from, point, windows });

  it("joins the strip of another window", () => {
    expect(land({ x: 700, y: 20 })).toEqual({ place: "band", window: right });
  });

  it("stays put over its own strip", () => {
    expect(land({ x: 100, y: 20 })).toEqual({ place: "none" });
  });

  it("stays in a strip a little past its edge only where it is held already", () => {
    const below = { x: 700, y: 50 };
    expect(land(below)).toEqual({ place: "new" });
    const held = { ...right, reach: 24 };
    expect(land(below, [left, held])).toEqual({ place: "band", window: held });
  });

  it("is a window of its own over nothing", () => {
    expect(land({ x: 550, y: 300 })).toEqual({ place: "new" });
  });

  it("is a window of its own over another window's page", () => {
    expect(land({ x: 700, y: 300 })).toEqual({ place: "new" });
  });

  it("is a window of its own over its own window's page", () => {
    expect(land({ x: 100, y: 300 })).toEqual({ place: "new" });
  });

  it("cannot reach a strip another window covers", () => {
    expect(land({ x: 150, y: 120 }, [over, left])).toEqual({
      place: "band",
      window: over,
    });
    expect(
      land({ x: 150, y: 20 }, [over, left, right], { from: right }),
    ).toEqual({ place: "band", window: left });
    expect(
      land({ x: 150, y: 200 }, [over, left, right], { from: right }),
    ).toEqual({ place: "new" });
  });

  it("stays put when canceled or never moved", () => {
    expect(land({ x: 700, y: 20 }, undefined, { canceled: true })).toEqual({
      place: "none",
    });
    expect(land(undefined)).toEqual({ place: "none" });
  });
});
