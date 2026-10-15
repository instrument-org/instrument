import { describe, expect, it } from "vitest";

import { isClosedDiskRoot } from "../disk-root";
import { windowsDrives } from "./places";
import { reachOf, rulesFor } from "./rules";

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

describe("what runs code later stays closed with folders open unasked", () => {
  const home = "/home/someone";
  const rules = rulesFor({
    home,
    settings: {
      apps: [],
      chats: {},
      folders: [],
      places: {},
      withoutAsking: true,
    },
  });

  it.each([
    ".config/git/config",
    ".config/fish/conf.d/x.fish",
    ".config/fish/functions/ls.fish",
    ".config/systemd/user/x.service",
    ".config/environment.d/x.conf",
  ])("~/%s", (place) => {
    expect(reachOf(rules, `${home}/${place}`, "write").level).toBe("never");
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
