import { describe, expect, it } from "vitest";

import { allocateFairShare } from "./fair-share";

describe("allocateFairShare", () => {
  it("leaves everything whole when it all fits", () => {
    expect(allocateFairShare([10, 20, 30], 100)).toEqual([10, 20, 30]);
  });

  it("gives short pieces their whole length and splits the rest", () => {
    // 10 and 20 fit an equal share, so the 970 they leave behind goes to the
    // two long ones rather than being lost to a head-of-list cutoff.
    expect(allocateFairShare([10, 20, 5000, 5000], 1000)).toEqual([
      10, 20, 485, 485,
    ]);
  });

  it("splits evenly when nothing fits its share", () => {
    expect(allocateFairShare([5000, 5000, 5000], 900)).toEqual([300, 300, 300]);
  });

  it("spends the whole budget when it does not divide evenly", () => {
    const allowances = allocateFairShare([500, 500, 500], 100);
    expect(allowances).toEqual([34, 33, 33]);
    expect(allowances.reduce((total, value) => total + value, 0)).toBe(100);
  });

  it("does not let one enormous piece starve the others", () => {
    expect(allocateFairShare([1_000_000, 100, 100], 1000)).toEqual([
      800, 100, 100,
    ]);
  });

  it("keeps a lone piece within the budget", () => {
    expect(allocateFairShare([50_000], 16_000)).toEqual([16_000]);
  });

  it("allows nothing when there is no budget", () => {
    expect(allocateFairShare([100, 200], 0)).toEqual([0, 0]);
  });

  it("has nothing to allocate for no pieces", () => {
    expect(allocateFairShare([], 1000)).toEqual([]);
  });
});
