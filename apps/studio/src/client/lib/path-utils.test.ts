import { describe, expect, it } from "vitest";

import { hostPathFromShellPath } from "./path-utils";

describe("hostPathFromShellPath", () => {
  it.each([
    ["/c/Users/x", true, "C:\\Users\\x"],
    ["/d", true, "D:\\"],
    ["/Users/x", false, "/Users/x"],
    ["C:\\Users\\x", true, "C:\\Users\\x"],
  ])("reads %s (windows: %s) as %s", (path, windows, expected) => {
    expect(hostPathFromShellPath(path, windows)).toBe(expected);
  });
});
