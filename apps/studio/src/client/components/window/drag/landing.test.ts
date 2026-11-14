import { describe, expect, it } from "vitest";

import {
  hasRested,
  isOffWindow,
  restAt,
  scrollSpeed,
  sideZoneAt,
  splitBandWidth,
} from "./landing";

const page = { height: 600, left: 100, top: 80, width: 900 };
const left = { height: 600, left: 100, top: 80, width: 440 };
const right = { height: 600, left: 548, top: 80, width: 452 };

describe("a side's page under something held", () => {
  it("over a lone side, from elsewhere, makes a side at each end and joins in the middle", () => {
    expect(
      [120, 550, 980].map((x) =>
        sideZoneAt({
          held: {},
          point: { x, y: 300 },
          sides: [page],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "kind": "split",
          "lit": {
            "height": 600,
            "left": 100,
            "top": 80,
            "width": 450,
          },
          "side": 0,
        },
        {
          "kind": "join",
          "lit": {
            "height": 600,
            "left": 100,
            "top": 80,
            "width": 900,
          },
          "side": 0,
        },
        {
          "kind": "split",
          "lit": {
            "height": 600,
            "left": 550,
            "top": 80,
            "width": 450,
          },
          "side": 1,
        },
      ]
    `);
  });

  it("takes nothing in a lone side's middle from a tab already there", () => {
    expect(
      sideZoneAt({
        held: { side: 0 },
        point: { x: 550, y: 300 },
        sides: [page],
      }),
    ).toBeUndefined();
  });

  it("makes no side of a side's only tab", () => {
    expect(
      sideZoneAt({
        held: { isAlone: true, side: 0 },
        point: { x: 980, y: 300 },
        sides: [page],
      }),
    ).toBeUndefined();
  });

  it("is the page's middle at its ends until the pointer has rested there", () => {
    expect(
      [110, 990].map((x) => {
        const zone = sideZoneAt({
          held: {},
          point: { x, y: 300 },
          sides: [page],
          splits: false,
        });
        return zone && `${zone.kind} ${zone.lit.width}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "join 900",
        "join 900",
      ]
    `);
  });

  it.each([
    ["the left side from the right", 1, 200, "join 0"],
    ["the right side from the left", 0, 700, "join 1"],
    ["its own side", 0, 200, "none"],
    ["the gutter", 0, 544, "none"],
  ] as const)("of two sides, over %s", (_, side, x, expected) => {
    const zone = sideZoneAt({
      held: { side },
      point: { x, y: 300 },
      sides: [left, right],
    });
    expect(zone ? `${zone.kind} ${zone.side}` : "none").toBe(expected);
  });

  it("is nowhere off the pages", () => {
    expect(
      sideZoneAt({
        held: {},
        point: { x: 550, y: 40 },
        sides: [page],
      }),
    ).toBeUndefined();
  });
});

describe("the band at a lone side's end", () => {
  it.each([
    [440, 120],
    [900, 180],
    [2400, 360],
    [300, 100],
  ])("of a page %ipx wide is %ipx", (width, band) => {
    expect(splitBandWidth(width)).toBe(band);
  });
});

describe("a rest over a place", () => {
  it("starts when the place changes and holds while it stays", () => {
    const first = restAt(undefined, "split 1", 100);
    const still = restAt(first, "split 1", 300);
    const moved = restAt(still, "split 0", 350);
    expect([first, still === first, moved, restAt(moved, undefined, 400)])
      .toMatchInlineSnapshot(`
      [
        {
          "key": "split 1",
          "since": 100,
        },
        true,
        {
          "key": "split 0",
          "since": 350,
        },
        undefined,
      ]
    `);
  });

  it.each([
    [0, false],
    [399, false],
    [400, true],
  ])("after %ims has rested: %s", (ms, rested) => {
    expect(hasRested({ key: "join 0", since: 1000 }, 1000 + ms)).toBe(rested);
  });
});

describe("a list scrolling under a pointer near its end", () => {
  const list = { end: 800, start: 0 };
  it.each([
    ["in the middle", 400, 1000, 0],
    ["just inside the top zone", 170, 1000, -100],
    ["deep in the top zone", 20, 1000, -900],
    ["past the top", -30, 1000, -900],
    ["deep in the bottom zone", 790, 1000, 900],
    ["deep in the bottom zone, just arrived", 790, 100, 56],
    ["deep in the bottom zone, a moment after", 790, 200, 225],
  ])("%s", (_, at, heldFor, speed) => {
    expect(Math.round(scrollSpeed({ ...list, at, heldFor }))).toBe(speed);
  });

  it("does nothing in a list with no length", () => {
    expect(scrollSpeed({ at: 0, end: 0, heldFor: 1000, start: 0 })).toBe(0);
  });
});

describe("the pointer off the window", () => {
  const size = { height: 800, width: 1200 };
  it.each([
    [{ x: 600, y: 400 }, false],
    [{ x: -10, y: 400 }, false],
    [{ x: -17, y: 400 }, true],
    [{ x: 1216, y: 400 }, true],
    [{ x: 600, y: 815 }, false],
    [{ x: 600, y: -40 }, true],
  ])("at %o: %s", (point, off) => {
    expect(isOffWindow(point, size)).toBe(off);
  });
});
