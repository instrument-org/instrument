import { describe, expect, it } from "vitest";

import { sideKeysOf } from "./side-motion";

const drawn = (...sides: string[][]) =>
  sides.map((tabs, index) => ({
    at: index === 1 ? (1 as const) : (0 as const),
    key: index,
    tabs,
  }));

describe("sideKeysOf", () => {
  it.each([
    {
      after: [["a"], ["b"]],
      before: drawn(["a"]),
      keys: [0, 1],
      what: "a side opening on the right takes a new key",
    },
    {
      after: [["b"], ["a"]],
      before: drawn(["a"]),
      keys: [1, 0],
      what: "a side opening on the left takes a new key, the other keeps its own",
    },
    {
      after: [["b"]],
      before: drawn(["a"], ["b"]),
      keys: [1],
      what: "the right side staying as the left closes keeps its key",
    },
    {
      after: [["c"]],
      before: drawn(["a"]),
      keys: [0],
      what: "a lone side whose tabs all changed keeps its key",
    },
    {
      after: [["a", "b"]],
      before: drawn(["a"], ["b"]),
      keys: [0],
      what: "two sides joined keep the left's key",
    },
  ])("$what", ({ after, before, keys }) => {
    expect(sideKeysOf(before, after)).toEqual(keys);
  });
});
