import { describe, expect, it } from "vitest";

import { fitTrail } from "./folding-trail";

// Five folders, each a 16px mark, a 4px gap and a 100px name, 10px between
// parts: 600px whole.
const sizes = Array.from({ length: 5 }, () => ({
  gap: 4,
  markOnly: 16,
  name: 100,
}));
const fitAt = (width: number) =>
  fitTrail(sizes, {
    floor: 40,
    hasMark: sizes.map(() => true),
    reserve: 0,
    separator: 10,
    width,
  })
    .map((fit) =>
      fit.kind === "cut" ? `cut ${Math.round(fit.width)}` : fit.kind,
    )
    .join(", ");

describe("fitTrail", () => {
  it.each([
    [700, "whole, whole, whole, whole, whole"],
    // Names shorten together before anything folds.
    [500, "cut 65, cut 65, cut 65, cut 65, whole"],
    // The folders between the first and the parent fold at once.
    [370, "cut 69, folded, folded, cut 69, whole"],
    // Then the first.
    [300, "folded, folded, folded, cut 72, whole"],
    // Then the parent, and last of all the last name is cut.
    [230, "folded, folded, folded, folded, whole"],
    [150, "folded, folded, folded, folded, cut 26"],
  ])("at %ipx: %s", (width, expected) => {
    expect(fitAt(width)).toBe(expected);
  });

  it("never folds a part with no mark", () => {
    const fits = fitTrail(sizes, {
      floor: 40,
      hasMark: [false, true, true, true, true],
      reserve: 0,
      separator: 10,
      width: 150,
    });
    expect(fits[0]?.kind).not.toBe("folded");
  });
});
