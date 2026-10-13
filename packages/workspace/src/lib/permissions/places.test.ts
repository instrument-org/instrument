import { describe, expect, it } from "vitest";

import { isClosedDiskRoot } from "../disk-root";
import { windowsDrives } from "./places";

describe("windowsDrives", () => {
  it("lists every present drive but the system one", () => {
    const present = new Set(["C:\\", "D:\\", "E:\\"]);
    expect(windowsDrives((root) => present.has(root), "C:")).toEqual([
      "D:\\",
      "E:\\",
    ]);
  });

  it("leaves out a system drive that is not C:", () => {
    const present = new Set(["C:\\", "D:\\"]);
    expect(windowsDrives((root) => present.has(root), "d:")).toEqual(["C:\\"]);
  });
});

describe("isClosedDiskRoot", () => {
  it.each([
    ["/", "darwin", true],
    ["/Volumes", "darwin", false],
    ["C:\\", "win32", true],
    ["D:\\", "win32", false],
    ["D:\\Photos", "win32", false],
  ] as const)("%s on %s is %s", (folder, platform, closed) => {
    expect(isClosedDiskRoot(folder, platform, "C:")).toBe(closed);
  });
});
