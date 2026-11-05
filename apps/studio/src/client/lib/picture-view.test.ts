import { describe, expect, it } from "vitest";

import { panReach, settleView, zoomedAt } from "./picture-view";

const box = {
  imageHeight: 200,
  imageWidth: 400,
  maxScale: 8,
  viewHeight: 500,
  viewWidth: 500,
};

describe("settleView", () => {
  it.each([
    ["stops at the left and right edges", { scale: 2, x: 9999, y: 0 }, 150],
    ["stops the other way too", { scale: 2, x: -9999, y: 0 }, -150],
    ["keeps a place within reach", { scale: 2, x: 40, y: 0 }, 40],
    ["centers a picture that fits", { scale: 1, x: 90, y: 0 }, 0],
  ])("%s", (_name, view, x) => {
    expect(settleView(view, box).x).toBe(x);
  });

  it("settles each axis on its own", () => {
    // 800 x 400 in a 500 pane: wider than the pane, not as tall.
    expect(settleView({ scale: 2, x: 60, y: 60 }, box)).toEqual({
      scale: 2,
      x: 60,
      y: 0,
    });
  });

  it("holds the scale between fit and the cap", () => {
    expect(settleView({ scale: 0.2, x: 0, y: 0 }, box).scale).toBe(1);
    expect(settleView({ scale: 80, x: 0, y: 0 }, box).scale).toBe(8);
  });
});

describe("panReach", () => {
  it("is nothing until the picture is larger than the pane", () => {
    expect(panReach(box, 1)).toEqual({ x: 0, y: 0 });
    expect(panReach(box, 3)).toEqual({ x: 350, y: 50 });
  });
});

describe("zoomedAt", () => {
  it("keeps the spot under the point where it is", () => {
    const view = { scale: 2, x: 30, y: -10 };
    const point = { x: 100, y: 50 };
    const next = zoomedAt(view, 4, point, box);
    const spotBefore = (point.x - view.x) / view.scale;
    const spotAfter = (point.x - next.x) / next.scale;
    expect(spotAfter).toBe(spotBefore);
  });

  it("leaves the picture where it is when pushed past the cap", () => {
    const view = { scale: 8, x: 300, y: -40 };
    expect(zoomedAt(view, 12, { x: 100, y: 50 }, box)).toEqual(view);
  });
});
