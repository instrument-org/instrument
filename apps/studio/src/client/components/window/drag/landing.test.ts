import { describe, expect, it } from "vitest";

import {
  isOffWindow,
  onPages,
  pagesReach,
  pullOf,
  scrollSpeed,
  sideZoneAt,
  splitTargetRect,
  splitTargetsOf,
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

  it("splits as soon as a pointer moving across the page reaches its end", () => {
    // 600 px a second, a frame at a time, never stopping.
    const zones = [];
    for (let x = 500; x < 1000; x += 10) {
      const zone = sideZoneAt({
        held: { isAlone: false, side: 0 },
        point: { x, y: 300 },
        sides: [page],
      });
      zones.push(zone ? `${zone.kind} ${zone.side}` : "none");
    }
    // The right target starts at 822, and takes it 36px short of that.
    expect(500 + zones.indexOf("split 1") * 10).toBe(790);
    expect(new Set(zones)).toEqual(new Set(["none", "split 1"]));
  });

  it("splits only near a target, short of the page's full height", () => {
    expect(
      [100, 300, 660].map(
        (y) =>
          sideZoneAt({
            held: { isAlone: false, side: 0 },
            point: { x: 900, y },
            sides: [page],
          })?.kind ?? "none",
      ),
    ).toEqual(["none", "split", "none"]);
  });

  it("splits at the very end at any height, as a tab flung to the edge does", () => {
    expect(
      sideZoneAt({
        held: { isAlone: false, side: 0 },
        point: { x: 990, y: 100 },
        sides: [page],
      })?.side,
    ).toBe(1);
  });

  it("keeps a split it took over the whole half it makes", () => {
    const at = (lit?: 0 | 1) =>
      sideZoneAt({
        held: { isAlone: false, side: 0 },
        ...(lit === undefined ? {} : { lit }),
        point: { x: 600, y: 120 },
        sides: [page],
      })?.kind ?? "none";
    expect([at(), at(1), at(0)]).toEqual(["none", "split", "none"]);
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

describe("a lone side's split targets", () => {
  it("stand in from each end, narrower than the half and shorter than the page", () => {
    expect(
      [0, 1].map((side) => splitTargetRect({ page, side: side === 1 ? 1 : 0 })),
    ).toMatchInlineSnapshot(`
        [
          {
            "height": 300,
            "left": 116,
            "top": 230,
            "width": 162,
          },
          {
            "height": 300,
            "left": 822,
            "top": 230,
            "width": 162,
          },
        ]
      `);
  });

  it("are shown from a drag's start, left first", () => {
    expect(
      splitTargetsOf({ held: { isAlone: false, side: 0 }, sides: [page] }).map(
        (target) => target.side,
      ),
    ).toEqual([0, 1]);
  });

  it.each([
    ["a side's only tab", { isAlone: true, side: 0 as const }, [page]],
    ["two sides", {}, [left, right]],
  ])("are none for %s", (_, held, sides) => {
    expect(splitTargetsOf({ held, sides })).toEqual([]);
  });

  it.each([
    ["far off", 600, 0],
    ["at the edge of its pull", 822 - 140, 0],
    ["halfway in", 822 - 88, 0.5],
    ["where it takes what is held", 822 - 36, 1],
    ["over it", 900, 1],
  ])("pull %s", (_, x, pull) => {
    expect(pullOf({ page, side: 1 }, { x, y: 380 })).toBeCloseTo(pull);
  });
});

describe("the margin past a group's outer page", () => {
  const window = 1240;
  const near = { height: 760, left: 328, top: 48, width: 904 };
  it("reaches on past the window's edge from a page near it", () => {
    expect(pagesReach([near], window)).toEqual({
      height: 760,
      left: 328,
      top: 48,
      width: 1256 - 328,
    });
  });

  it("reaches both edges with the sidebar closed, and neither from a page set in", () => {
    const whole = { ...near, left: 8, width: 1224 };
    const setIn = { ...near, width: 800 };
    expect([
      pagesReach([whole], window)?.left,
      pagesReach([setIn], window),
    ]).toEqual([-16, setIn]);
  });

  it("is the page's end, which splits", () => {
    const point = onPages({ x: 1250, y: 300 }, [near]);
    expect([
      point,
      sideZoneAt({ held: {}, point, sides: [near] })?.kind,
    ]).toEqual([{ x: 1231, y: 300 }, "split"]);
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
