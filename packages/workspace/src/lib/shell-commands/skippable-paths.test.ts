import { describe, expect, it } from "vitest";

import { leavesAPath, skippablePaths } from "./skippable-paths";

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

describe("leavesAPath", () => {
  const onDisk = new Set(["good"]);
  const isPath = (operand: string) => onDisk.has(operand);

  it.each([
    ["a real path is left", ["-l", "needle", "good", "~/.ssh"], [3], true],
    [
      "every path is refused",
      ["-l", "needle", "good", "~/.ssh"],
      [2, 3],
      false,
    ],
    [
      "only a word that is no path",
      ["-A", "3", "needle", "~/.ssh"],
      [3],
      false,
    ],
    ["only the pattern", ["needle", "~/.ssh"], [1], false],
  ])("%s", (_name, args, refused, expected) => {
    expect(leavesAPath(args, refused, skippablePaths(args), isPath)).toBe(
      expected,
    );
  });
});
