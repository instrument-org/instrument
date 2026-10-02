import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { describe, expect, it } from "vitest";

import { trafficLightPositionForZoom } from "./traffic-lights";

// The buttons are drawn by macOS in real pixels over a band of chrome the
// renderer draws in layout px, so the band's visual height is the zoom the
// window is drawn at and the cluster has to be re-centered for each level.
// Anything computed off the unzoomed band alone is right at 1x and wrong at
// every other level, which is how this is missed.

describe("traffic lights against a zoomed band", () => {
  it.each([
    [0.5, 2],
    [1, 12],
    [1.5, 22],
    [2, 32],
  ])("centers the cluster in the band at %sx", (zoom, y) => {
    expect(trafficLightPositionForZoom(zoom)).toEqual({ x: 12, y });
  });

  it("keeps the cluster in the window when the band is shorter than it is", () => {
    // Below the ladder's own floor, but the arithmetic is what holds the
    // buttons on screen rather than the range that feeds it.
    expect(trafficLightPositionForZoom(0.1).y).toBe(0);
  });

  it("centers against the band the chrome actually draws", () => {
    const centered = trafficLightPositionForZoom(1);
    expect(centered.y * 2 + 16).toBe(TOOLBAR_HEIGHT);
  });
});
