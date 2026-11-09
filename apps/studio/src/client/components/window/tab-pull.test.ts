import { describe, expect, it } from "vitest";

import { isOffRow, recentPath } from "./tab-pull";

const strip = { bottom: 40, top: 8 };
const off = (
  points: [number, number][],
  { wasOff = false, windowWidth = 1000 } = {},
) =>
  isOffRow({
    path: points.map(([x, y], at) => ({ at, x, y })),
    strip,
    wasOff,
    windowWidth,
  });

describe("whether a tab has left its row", () => {
  it("stays on while the pointer is on the row", () => {
    expect(off([[100, 20]])).toBe(false);
  });

  it("comes off at once when pulled straight down", () => {
    expect(
      off([
        [100, 30],
        [100, 50],
      ]),
    ).toBe(true);
  });

  it("comes off at once when pulled straight up", () => {
    expect(
      off([
        [100, 10],
        [100, -2],
      ]),
    ).toBe(true);
  });

  it("stays on when a sweep along the row drifts off it", () => {
    expect(
      off([
        [100, 38],
        [200, 60],
      ]),
    ).toBe(false);
  });

  it("comes off a sweep once it has gone far past the row", () => {
    expect(
      off([
        [100, 80],
        [200, 84],
      ]),
    ).toBe(true);
  });

  it("stays on a hair past the row, however steep", () => {
    expect(
      off([
        [100, 30],
        [100, 45],
      ]),
    ).toBe(false);
  });

  it("stays on when heading back to the row", () => {
    expect(
      off([
        [100, 70],
        [100, 55],
      ]),
    ).toBe(false);
  });

  it("stays off until the pointer is back on the row", () => {
    expect(off([[100, 45]], { wasOff: true })).toBe(true);
    expect(off([[100, 39]], { wasOff: true })).toBe(false);
  });

  it.each([-17, 1017])("comes off past the window's side at %d", (x) => {
    expect(off([[x, 20]])).toBe(true);
  });
});

describe("a pointer's recent path", () => {
  it("keeps only what says where it is heading now", () => {
    expect(
      recentPath(
        [
          { at: 0, x: 0, y: 0 },
          { at: 50, x: 1, y: 1 },
        ],
        { at: 100, x: 2, y: 2 },
      ).map(({ at }) => at),
    ).toEqual([50, 100]);
  });
});
