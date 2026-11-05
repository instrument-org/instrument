import { describe, expect, it } from "vitest";

import { skippablePaths, withoutRefused } from "./skippable-paths";

describe("skippablePaths", () => {
  it.each([
    ["flags, pattern, paths", ["-l", "needle", "good", "~/.ssh"], [2, 3]],
    ["a flag's value first", ["-g", "*.ts", "needle", "a", "b"], [2, 3, 4]],
    ["pattern and one path", ["needle", "good"], [1]],
    ["a flag after the paths", ["needle", "a", "b", "-l"], []],
    ["stdin as a path", ["needle", "-", "a"], []],
    ["nothing", [], []],
  ])("%s", (_name, args, expected) => {
    expect([...skippablePaths(args)]).toEqual(expected);
  });
});

describe("withoutRefused", () => {
  const args = ["-l", "needle", "good", "~/.ssh"];

  it("takes out a refused path", () => {
    expect(withoutRefused(args, [3], new Set([2, 3]))).toEqual([
      "-l",
      "needle",
      "good",
    ]);
  });

  it("refuses when no path would be left", () => {
    expect(withoutRefused(args, [2, 3], new Set([2, 3]))).toBeUndefined();
  });

  it("refuses when what was refused can't be left out", () => {
    expect(withoutRefused(args, [1], new Set([2, 3]))).toBeUndefined();
  });

  it("counts a find's start points past its options", () => {
    expect(
      withoutRefused(["-L", "a", "b", "-name", "x"], [1], new Set([0, 1]), 1),
    ).toEqual(["-L", "a", "-name", "x"]);
  });
});
