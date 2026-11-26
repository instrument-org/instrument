import { describe, expect, it } from "vitest";

import {
  EDGE_PX,
  type HeldInGroup,
  isOffWindow,
  onPages,
  pagesReach,
  PIECE_EDGE_PX,
  REST_MS,
  scrollSpeed,
  sideZoneAt,
  type Steady,
  steadyPick,
} from "./landing";

const page = { height: 600, left: 100, top: 80, width: 900 };
const left = { height: 600, left: 100, top: 80, width: 440 };
const right = { height: 600, left: 548, top: 80, width: 452 };

const CONTENT: HeldInGroup = { kind: "content" };
const OTHER_TAB: HeldInGroup = { kind: "tab" };
const OWN_TAB: HeldInGroup = { isAlone: false, kind: "tab", side: 0 };
const GROUP: HeldInGroup = { kind: "group" };

/** What a zone comes to, in a word, for a table. */
function said(zone: ReturnType<typeof sideZoneAt>) {
  if (!zone) {
    return "none";
  }
  return `${zone.kind} ${String(zone.side)}${zone.edge ? " at the edge" : ""}${zone.kind === "join" && zone.isLone ? " as a new tab" : ""}`;
}

describe("a side's page under something held", () => {
  it("over a lone side, splits only at its outer edges, deeper for a piece of the window than for content", () => {
    const xs = [
      101,
      100 + EDGE_PX,
      100 + PIECE_EDGE_PX - 1,
      100 + PIECE_EDGE_PX,
      550,
      1000 - PIECE_EDGE_PX - 1,
      1000 - PIECE_EDGE_PX,
      1000 - EDGE_PX - 1,
      1000 - EDGE_PX,
    ];
    const table = Object.entries({
      content: CONTENT,
      "a tab from elsewhere": OTHER_TAB,
      "its own tab": OWN_TAB,
      "a whole group": GROUP,
    }).flatMap(([name, held]) => [
      `${name}:`,
      ...xs.map(
        (x) =>
          `  ${String(x)} → ${said(sideZoneAt({ held, point: { x, y: 300 }, sides: [page] }))}`,
      ),
    ]);
    expect(table.join("\n")).toMatchInlineSnapshot(`
      "content:
        101 → split 0 at the edge
        124 → join 0 as a new tab
        195 → join 0 as a new tab
        196 → join 0 as a new tab
        550 → join 0 as a new tab
        903 → join 0 as a new tab
        904 → join 0 as a new tab
        975 → join 0 as a new tab
        976 → split 1 at the edge
      a tab from elsewhere:
        101 → split 0 at the edge
        124 → split 0 at the edge
        195 → split 0 at the edge
        196 → none
        550 → none
        903 → none
        904 → split 1 at the edge
        975 → split 1 at the edge
        976 → split 1 at the edge
      its own tab:
        101 → split 0 at the edge
        124 → split 0 at the edge
        195 → split 0 at the edge
        196 → none
        550 → none
        903 → none
        904 → split 1 at the edge
        975 → split 1 at the edge
        976 → split 1 at the edge
      a whole group:
        101 → split 0 at the edge
        124 → split 0 at the edge
        195 → split 0 at the edge
        196 → none
        550 → none
        903 → none
        904 → split 1 at the edge
        975 → split 1 at the edge
        976 → split 1 at the edge"
    `);
  });

  it("lights the half and draws the line down the edge it splits at", () => {
    expect(
      sideZoneAt({ held: CONTENT, point: { x: 990, y: 300 }, sides: [page] }),
    ).toMatchInlineSnapshot(`
      {
        "edge": {
          "height": 576,
          "left": 994,
          "top": 92,
          "width": 3,
        },
        "kind": "split",
        "lit": {
          "height": 600,
          "left": 550,
          "top": 80,
          "width": 450,
        },
        "side": 1,
      }
    `);
  });

  it("makes no side of a side's only tab", () => {
    expect(
      sideZoneAt({
        held: { isAlone: true, kind: "tab", side: 0 },
        point: { x: 990, y: 300 },
        sides: [page],
      }),
    ).toBeUndefined();
  });

  it("never splits a pointer moving across the page until it reaches the edge", () => {
    // 240 px a second, a frame at a time, never stopping.
    const zones = [];
    for (let x = 500; x < 1000; x += 4) {
      zones.push(
        said(
          sideZoneAt({ held: OWN_TAB, point: { x, y: 300 }, sides: [page] }),
        ),
      );
    }
    expect(500 + zones.indexOf("split 1 at the edge") * 4).toBe(
      1000 - PIECE_EDGE_PX,
    );
    expect(new Set(zones)).toEqual(new Set(["none", "split 1 at the edge"]));
  });

  it.each([
    ["content", CONTENT, 1000 - 40, "join 0 as a new tab"],
    ["a tab", OWN_TAB, 1000 - 160, "none"],
  ] satisfies [string, HeldInGroup, number, string][])(
    "keeps an edge it armed farther in for %s, so a hand resting there holds it",
    (_, held, kept, middle) => {
      const at = (x: number, armed?: 0 | 1) =>
        said(sideZoneAt({ armed, held, point: { x, y: 120 }, sides: [page] }));
      expect([at(kept), at(kept, 1), at(kept, 0), at(kept - 1, 1)]).toEqual([
        middle,
        "split 1 at the edge",
        middle,
        middle,
      ]);
    },
  );

  it("arms nothing at an end that waits, and the other end as ever", () => {
    const at = (x: number, waits?: 0 | 1) =>
      said(
        sideZoneAt({ held: GROUP, point: { x, y: 300 }, sides: [page], waits }),
      );
    expect([at(150), at(150, 0), at(150, 1), at(990, 0)]).toEqual([
      "split 0 at the edge",
      "none",
      "split 0 at the edge",
      "split 1 at the edge",
    ]);
  });

  it.each([
    ["content over the left side", CONTENT, 200, "join 0"],
    ["content over the right side", CONTENT, 700, "join 1"],
    [
      "a tab over the other side's middle",
      { kind: "tab", side: 0 },
      700,
      "none",
    ],
    [
      "a tab at the other side's edge",
      { kind: "tab", side: 0 },
      990,
      "join 1 at the edge",
    ],
    [
      "a tab 90px in from the other side's edge",
      { kind: "tab", side: 0 },
      910,
      "join 1 at the edge",
    ],
    ["content 90px in from the right side's edge", CONTENT, 910, "join 1"],
    ["a tab at its own side's edge", { kind: "tab", side: 0 }, 110, "none"],
    ["a whole group anywhere", GROUP, 990, "none"],
    ["content in the gutter", CONTENT, 544, "none"],
  ] satisfies [string, HeldInGroup, number, string][])(
    "of two sides, %s",
    (_, held, x, expected) => {
      expect(
        said(sideZoneAt({ held, point: { x, y: 300 }, sides: [left, right] })),
      ).toBe(expected);
    },
  );

  it("is nowhere off the pages", () => {
    expect(
      sideZoneAt({ held: CONTENT, point: { x: 550, y: 40 }, sides: [page] }),
    ).toBeUndefined();
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

  it("is the page's edge, which splits", () => {
    const point = onPages({ x: 1250, y: 300 }, [near]);
    expect([
      point,
      sideZoneAt({ held: CONTENT, point, sides: [near] })?.kind,
    ]).toEqual([{ x: 1231, y: 300 }, "split"]);
  });
});

describe("a list scrolling under a pointer near its end", () => {
  const list = { end: 800, start: 0 };
  it.each([
    ["in the middle", 400, 1000, 0],
    ["just inside the top zone", 56, 1000, -225],
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

describe("a steady landing among three 100px tabs", () => {
  const spansOf = (isTakeable: boolean) =>
    [0, 100, 200].map((start) => ({ isTakeable, size: 100, start }));

  /** The picks of a pointer walked through `[at, now]` steps, one measure each. */
  const walk = (steps: [number, number][], isTakeable = true) => {
    let was: Steady = {};
    return steps.map(([at, now]) => {
      const { next, pick } = steadyPick({
        at,
        now,
        spans: spansOf(isTakeable),
        was,
      });
      was = next;
      return `${String(at)}@${String(now)} ${pick.kind} ${String(pick.index)}`;
    });
  };

  it("moves the line to the next gap only 6px past a tab's middle, either way", () => {
    expect(
      walk(
        [40, 55, 57, 48, 45, 43].map((at) => [at, 0]),
        false,
      ),
    ).toMatchInlineSnapshot(`
        [
          "40@0 gap 0",
          "55@0 gap 0",
          "57@0 gap 1",
          "48@0 gap 1",
          "45@0 gap 1",
          "43@0 gap 0",
        ]
      `);
  });

  it("goes into a tab after a rest on its middle 44%, and keeps it while the pointer stays in its middle 72%", () => {
    expect(
      walk([
        [150, 0],
        [160, REST_MS - 1],
        [160, REST_MS],
        [185, REST_MS + 10],
        [187, REST_MS + 20],
      ]),
    ).toMatchInlineSnapshot(`
      [
        "150@0 gap 1",
        "160@219 gap 2",
        "160@220 into 1",
        "185@230 into 1",
        "187@240 gap 2",
      ]
    `);
  });

  it("starts the rest again on each tab's middle, and never past its middle 44%", () => {
    expect(
      walk([
        [150, 0],
        [250, 200],
        [250, 300],
        [250, 200 + REST_MS],
        [173, 1000],
        [173, 2000],
      ]),
    ).toMatchInlineSnapshot(`
      [
        "150@0 gap 1",
        "250@200 gap 2",
        "250@300 gap 2",
        "250@420 into 2",
        "173@1000 gap 2",
        "173@2000 gap 2",
      ]
    `);
  });

  it("says when a rest under way is done", () => {
    expect(
      steadyPick({ at: 150, now: 1000, spans: spansOf(true) }).wakeAt,
    ).toBe(1000 + REST_MS);
    expect(
      steadyPick({ at: 175, now: 1000, spans: spansOf(true) }).wakeAt,
    ).toBeUndefined();
  });
});
