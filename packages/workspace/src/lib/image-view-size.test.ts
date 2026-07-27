import { describe, expect, it } from "vitest";

import {
  imagePatchCount,
  type ImageViewLimits,
  imageViewSize,
  PREVIEW_LIMITS,
} from "./image-view-size";

const DEFAULT_LIMITS = PREVIEW_LIMITS;

// The high-resolution tier documented for Claude. Not what anything is
// configured with, but the math has to hold for whatever we set.
const HIGH_TIER_LIMITS: ImageViewLimits = {
  maxEdge: 2576,
  maxPatches: 4784,
  patchSize: 28,
};

function fits(
  size: { height: number; width: number },
  limits: ImageViewLimits,
) {
  return (
    Math.ceil(size.width / limits.patchSize) * limits.patchSize <=
      limits.maxEdge &&
    Math.ceil(size.height / limits.patchSize) * limits.patchSize <=
      limits.maxEdge &&
    imagePatchCount({ ...size, limits }) <= limits.maxPatches
  );
}

describe("imageViewSize", () => {
  it.each([
    { height: 100, width: 100 },
    { height: 1, width: 1 },
    { height: 768, width: 1024 },
    { height: 812, width: 375 },
  ])("leaves $width x $height alone when it already fits", (size) => {
    expect(imageViewSize({ ...size, limits: DEFAULT_LIMITS })).toEqual(size);
  });

  it.each([
    { height: 2160, limits: DEFAULT_LIMITS, width: 3840 },
    { height: 2160, limits: HIGH_TIER_LIMITS, width: 3840 },
    { height: 12_000, limits: DEFAULT_LIMITS, width: 9000 },
    { height: 4000, limits: DEFAULT_LIMITS, width: 100 },
    { height: 100, limits: DEFAULT_LIMITS, width: 4000 },
    { height: 3000, limits: DEFAULT_LIMITS, width: 3000 },
    // Sits exactly on maxEdge, so only the patch cap rules it out. The two caps
    // are not redundant and a 16:9 image hits this one first.
    { height: 882, limits: DEFAULT_LIMITS, width: 1568 },
  ])(
    "brings $width x $height inside the budget and cannot go one pixel wider",
    ({ limits, ...size }) => {
      const result = imageViewSize({ ...size, limits });

      expect(fits(result, limits)).toBe(true);
      expect(result.width).toBeLessThanOrEqual(size.width);
      expect(result.height).toBeLessThanOrEqual(size.height);

      const aspect = size.width / size.height;
      const wider = result.width + 1;
      expect(
        fits(
          { height: Math.max(1, Math.round(wider / aspect)), width: wider },
          limits,
        ),
      ).toBe(false);
    },
  );

  it("holds the aspect ratio within a pixel", () => {
    const result = imageViewSize({
      height: 2160,
      limits: DEFAULT_LIMITS,
      width: 3840,
    });
    expect(Math.abs(result.width / result.height - 3840 / 2160)).toBeLessThan(
      0.01,
    );
  });

  it("scales a tiny crop up to fill the budget", () => {
    // The upscale target for a magnified crop: an absurd input size makes the
    // search return the largest in-budget size for that aspect ratio.
    const result = imageViewSize({
      height: 30 * 10_000,
      limits: DEFAULT_LIMITS,
      width: 40 * 10_000,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "height": 952,
        "width": 1269,
      }
    `);
    expect(fits(result, DEFAULT_LIMITS)).toBe(true);
  });

  it("reports the resize a 4K screenshot needs", () => {
    expect(imageViewSize({ height: 2160, limits: DEFAULT_LIMITS, width: 3840 }))
      .toMatchInlineSnapshot(`
        {
          "height": 819,
          "width": 1456,
        }
      `);
  });
});

describe("PREVIEW_LIMITS", () => {
  it("is one budget, not a per-provider lookup", () => {
    // A coordinate space that changes with the active model cannot be referred
    // to by a message written before the switch, so this is deliberately a
    // constant and the test exists to keep it one.
    expect(PREVIEW_LIMITS).toMatchInlineSnapshot(`
      {
        "maxEdge": 1568,
        "maxPatches": 1568,
        "patchSize": 28,
      }
    `);
  });
});
