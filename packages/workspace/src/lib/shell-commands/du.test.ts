import { describe, expect, it } from "vitest";

import { parseDuArgs } from "./du";

describe("parseDuArgs", () => {
  it.each([
    ["-sh", { human: true, maxDepth: 0 }],
    ["-hs", { human: true, maxDepth: 0 }],
    ["-d1", { maxDepth: 1 }],
    ["-hd1", { human: true, maxDepth: 1 }],
    ["--max-depth=2", { maxDepth: 2 }],
    ["-b", { apparent: true, unit: 1 }],
    ["--apparent-size", { apparent: true, unit: 1024 }],
    ["-m", { unit: 1024 * 1024 }],
    ["-ac", { all: true, grandTotal: true }],
  ])("reads %s", (flag, expected) => {
    expect(parseDuArgs([flag, "dir"])?.options).toMatchObject(expected);
  });

  it("takes a depth from the next argument", () => {
    expect(parseDuArgs(["-h", "-d", "1", "dir"])).toMatchObject({
      operands: ["dir"],
      options: { human: true, maxDepth: 1 },
    });
    expect(parseDuArgs(["--max-depth", "3", "dir"])?.options.maxDepth).toBe(3);
  });

  it("lets -s win over a depth, as GNU du does", () => {
    expect(parseDuArgs(["-d", "2", "-s", "dir"])?.options.maxDepth).toBe(0);
  });

  it("reads everything after -- as an operand", () => {
    expect(parseDuArgs(["-s", "--", "-odd-name"])?.operands).toEqual([
      "-odd-name",
    ]);
  });

  it.each([["-L"], ["--time"], ["--exclude=node_modules"], ["-d"], ["-dx"]])(
    "leaves %s to just-bash",
    (flag) => {
      expect(parseDuArgs([flag, "dir"])).toBeNull();
    },
  );
});
