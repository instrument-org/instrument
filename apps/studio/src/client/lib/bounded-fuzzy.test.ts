import { describe, expect, it } from "vitest";

import { boundedFuzzy } from "./bounded-fuzzy";

const fuzzy = boundedFuzzy({ intraMode: 1 });

function matches(haystack: string[], needle: string) {
  return fuzzy.filter(haystack, needle) ?? [];
}

describe("boundedFuzzy", () => {
  it("answers a pasted path against a page at a sibling path at once", () => {
    const pasted =
      "/private/tmp/claude-501/-Users-mac-user-code-instrument-instrument/f94deb05-c51c-4db2-acdf-fadbef4c012d/scratchpad/";
    const sibling =
      "file:///private/tmp/claude-501/-Users-mac-user-code-instrument-instrument/81958524-3483-444d-8e0e-15d7926e6b62/scratchpad/report.html";
    const started = performance.now();
    expect(matches([sibling, `${pasted}notes.md`], pasted)).toEqual([1]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("answers many short terms against a long entry at once", () => {
    const started = performance.now();
    expect(matches(["a".repeat(300)], `${"a ".repeat(12)}z`)).toEqual([]);
    expect(matches(["a".repeat(300)], "a a z")).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it.each([
    ["fix sandbox bug", ["Fix the sandbox bug"], [0]],
    ["sandbx", ["Fix the sandbox bug"], [0]],
    ["one two three four five", ["one two three four five"], [0]],
    ["one two three four FIVE", ["five four three two one"], []],
    ["one two three four five", ["one two three four"], []],
    ["one two three four Five", ["one two three four, then five"], [0]],
  ])("matches %j", (needle, haystack, expected) => {
    expect(matches(haystack, needle)).toEqual(expected);
  });

  it("ranks and highlights by the fuzzy terms", () => {
    const haystack = [
      "the alpha beta gamma delta epsilon",
      "alpha beta gamma delta epsilon",
    ];
    const needle = "alpha beta gamma delta epsilon";
    const indexes = fuzzy.filter(haystack, needle) ?? [];
    const info = fuzzy.info(indexes, haystack, needle);
    expect(
      fuzzy.sort(info, haystack, needle).map((at) => info.idx[at]),
    ).toEqual([1, 0]);
  });
});
