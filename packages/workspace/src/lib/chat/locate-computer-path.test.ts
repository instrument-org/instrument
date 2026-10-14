import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hostPathFromTyped, locateComputerPath } from "./locate-computer-path";

const mac = { home: "/Users/casey", platform: "darwin", tmp: "/tmp" } as const;
const linux = { home: "/home/casey", platform: "linux", tmp: "/tmp" } as const;
const windows = {
  home: "C:\\Users\\casey",
  platform: "win32",
  tmp: "C:\\Users\\casey\\AppData\\Local\\Temp",
} as const;

describe("hostPathFromTyped", () => {
  it.each([
    ["/Users/casey/Documents", "/Users/casey/Documents"],
    ["/Users/casey/Documents/", "/Users/casey/Documents"],
    ["/", "/"],
    ["~", "/Users/casey"],
    ["~/Bob's Files/Acme Corp", "/Users/casey/Bob's Files/Acme Corp"],
    ["  '/Users/casey/a b.pdf'  ", "/Users/casey/a b.pdf"],
    ["/Users/casey/My\\ File\\ \\(1\\).pdf", "/Users/casey/My File (1).pdf"],
    ["/Users/casey/back\\slash", "/Users/casey/back\\slash"],
    ["file:///~/testing123fake", "/Users/casey/testing123fake"],
    ["file:///Users/casey/a%20b.html", "/Users/casey/a b.html"],
    ["file://localhost/Users/casey", "/Users/casey"],
    ["/System/Volumes/Data/Users/casey/x", "/Users/casey/x"],
    [
      "/System/Volumes/Data/.Spotlight-V100",
      "/System/Volumes/Data/.Spotlight-V100",
    ],
    ["/Users/casey/../casey/./Desktop", "/Users/casey/Desktop"],
  ])("reads %j on a Mac as %j", (typed, expected) => {
    expect(hostPathFromTyped(typed, mac)).toBe(expected);
  });

  it.each([
    ["~/Downloads", "/home/casey/Downloads"],
    ["/System/Volumes/Data/Users/x", "/System/Volumes/Data/Users/x"],
    ["~\\Downloads", undefined],
  ])("reads %j on Linux as %j", (typed, expected) => {
    expect(hostPathFromTyped(typed, linux)).toBe(expected);
  });

  it.each([
    ["C:\\Users\\casey\\Documents", "C:\\Users\\casey\\Documents"],
    ["c:/Users/casey/Documents/", "c:\\Users\\casey\\Documents"],
    ["C:", "C:\\"],
    ["C:\\", "C:\\"],
    ['"C:\\Users\\casey\\a b.txt"', "C:\\Users\\casey\\a b.txt"],
    ["~\\Documents", "C:\\Users\\casey\\Documents"],
    ["~/Documents", "C:\\Users\\casey\\Documents"],
    ["/c/Users/casey", "C:\\Users\\casey"],
    ["/d", "D:\\"],
    ["/tmp/out.log", "C:\\Users\\casey\\AppData\\Local\\Temp\\out.log"],
    ["\\\\server\\share\\folder", "\\\\server\\share\\folder"],
    ["file:///C:/Users/casey/a%20b.html", "C:\\Users\\casey\\a b.html"],
    ["file://server/share/x", "\\\\server\\share\\x"],
    ["file:///~/x", "C:\\Users\\casey\\x"],
    ["/Users/casey", undefined],
    ["\\Users", undefined],
  ])("reads %j on Windows as %j", (typed, expected) => {
    expect(hostPathFromTyped(typed, windows)).toBe(expected);
  });

  it.each([
    "documents",
    "r/rust",
    "https://example.com",
    "file:///%E0%A4%A",
    "",
  ])("finds no path in %j", (typed) => {
    expect(hostPathFromTyped(typed, mac)).toBeUndefined();
  });
});

describe("locateComputerPath", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { force: true, recursive: true });
      dir = undefined;
    }
  });

  it("tells a folder, a file, and nothing apart, naming the closest folder above nothing", async () => {
    dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "locate-")),
    );
    await fs.writeFile(path.join(dir, "note.txt"), "hi");
    expect(await locateComputerPath(dir)).toEqual({
      kind: "folder",
      path: dir,
    });
    expect(await locateComputerPath(path.join(dir, "note.txt"))).toEqual({
      kind: "file",
      path: path.join(dir, "note.txt"),
    });
    expect(await locateComputerPath(path.join(dir, "gone", "deeper"))).toEqual({
      kind: "missing",
      nearest: dir,
      path: path.join(dir, "gone", "deeper"),
    });
    expect(await locateComputerPath(path.join(dir, "note.txt", "x"))).toEqual({
      kind: "missing",
      nearest: dir,
      path: path.join(dir, "note.txt", "x"),
    });
  });

  it("fails words that are no path without reading anything", async () => {
    expect(await locateComputerPath(" r/rust ")).toEqual({
      kind: "failed",
      path: "r/rust",
    });
  });
});
