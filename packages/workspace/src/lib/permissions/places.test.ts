import { describe, expect, it } from "vitest";

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
