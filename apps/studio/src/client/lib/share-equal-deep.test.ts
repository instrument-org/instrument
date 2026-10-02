import { describe, expect, it } from "vitest";

import { shareEqualDeep } from "./share-equal-deep";

describe("shareEqualDeep", () => {
  it("keeps the previous records whose dates are at the same instants", () => {
    const previous = [
      { at: new Date(1), id: "a", tags: ["x"] },
      { at: new Date(2), id: "b", tags: [] },
    ];
    const next = [
      { at: new Date(1), id: "a", tags: ["x"] },
      { at: new Date(2), id: "b", tags: ["y"] },
    ];
    const shared = shareEqualDeep(previous, next);
    expect(shared).not.toBe(previous);
    expect(shared[0]).toBe(previous[0]);
    expect(shared[1]).not.toBe(previous[1]);
    expect(shared[1]?.at).toBe(previous[1]?.at);
    expect(shared).toEqual(next);
  });

  it("hands back the previous value whole when nothing changed", () => {
    const previous = { at: new Date(1), list: [{ n: 1 }] };
    expect(
      shareEqualDeep(previous, { at: new Date(1), list: [{ n: 1 }] }),
    ).toBe(previous);
  });

  it.each([
    ["a moved date", { at: new Date(1) }, { at: new Date(2) }],
    ["a key gone", { a: 1, b: 2 }, { a: 1 }],
    ["a key swapped", { a: 1, b: undefined }, { a: 1, c: undefined }],
    ["an item added", [1], [1, 2]],
  ])("takes the next value for %s", (_name, previous, next) => {
    const shared = shareEqualDeep(previous, next);
    expect(shared).not.toBe(previous);
    expect(shared).toEqual(next);
  });
});
