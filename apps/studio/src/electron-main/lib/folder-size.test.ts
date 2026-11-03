import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { folderSize, folderSizeSkips } from "./folder-size";

describe("folderSize", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "folder-size-")),
    );
    await fs.mkdir(path.join(root, "inner", "deeper"), { recursive: true });
    await fs.writeFile(path.join(root, "a.txt"), "12345");
    await fs.writeFile(path.join(root, "inner", "b.txt"), "123");
    await fs.writeFile(path.join(root, "inner", "deeper", "c.txt"), "12");
  });
  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it("adds up the files at every depth", async () => {
    expect(await folderSize(root, { skips: new Set() })).toEqual({
      bytes: 10,
      complete: true,
    });
  });

  it("does not follow a link out of the folder", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "folder-size-"));
    await fs.writeFile(path.join(outside, "big.txt"), "x".repeat(1000));
    await fs.symlink(outside, path.join(root, "link"));
    const linkSize = (await fs.lstat(path.join(root, "link"))).size;
    expect(await folderSize(root, { skips: new Set() })).toEqual({
      bytes: 10 + linkSize,
      complete: true,
    });
    await fs.rm(outside, { force: true, recursive: true });
  });

  it("measures a link to a folder as that folder", async () => {
    const link = `${root}-link`;
    await fs.symlink(root, link);
    expect(await folderSize(link, { skips: new Set() })).toEqual({
      bytes: 10,
      complete: true,
    });
    await fs.rm(link);
  });

  it("recognizes a skipped folder when the walk came through a link", async () => {
    const link = `${root}-link`;
    await fs.symlink(root, link);
    const inner = path.join(await fs.realpath(root), "inner");
    expect(await folderSize(link, { skips: new Set([inner]) })).toEqual({
      bytes: 5,
      complete: false,
    });
    await fs.rm(link);
  });

  it("ends with what it has when a step stalls", async () => {
    const readdir = fs.readdir.bind(fs);
    const spy = vi
      .spyOn(fs, "readdir")
      .mockImplementation((async (folder: string, options: never) =>
        String(folder).endsWith("inner")
          ? new Promise(() => undefined)
          : readdir(folder, options)) as never);
    expect(await folderSize(root, { skips: new Set(), stallMs: 20 })).toEqual({
      bytes: 5,
      complete: false,
    });
    spy.mockRestore();
  });

  it("answers null when the folder itself stalls", async () => {
    const spy = vi
      .spyOn(fs, "readdir")
      .mockImplementation((() => new Promise(() => undefined)) as never);
    expect(
      await folderSize(root, { skips: new Set(), stallMs: 20 }),
    ).toBeNull();
    spy.mockRestore();
  });

  it("steps over a skipped folder and says the count is a floor", async () => {
    expect(
      await folderSize(root, { skips: new Set([path.join(root, "inner")]) }),
    ).toEqual({ bytes: 5, complete: false });
  });

  it("goes into a skipped folder when the walk starts there", async () => {
    expect(await folderSize(root, { skips: new Set([root]) })).toEqual({
      bytes: 10,
      complete: true,
    });
  });

  it("answers null for what is not a readable folder", async () => {
    expect(await folderSize(path.join(root, "a.txt"))).toBeNull();
    expect(await folderSize(path.join(root, "missing"))).toBeNull();
  });

  it("stops when nobody is waiting", async () => {
    await expect(
      folderSize(root, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  });
});

describe("folderSizeSkips", () => {
  it("names what macOS guards, and nothing elsewhere", () => {
    const skips = folderSizeSkips({
      home: "/Users/mac-user",
      platform: "darwin",
    });
    expect(skips.has("/Users/mac-user/Documents")).toBe(true);
    expect(skips.has("/Users/mac-user/Library/Containers")).toBe(true);
    expect(skips.has("/System/Volumes/Data")).toBe(true);
    expect(skips.has("/System/Volumes/Data/Users/mac-user/Documents")).toBe(
      true,
    );
    expect(skips.has("/Users/mac-user/Projects")).toBe(false);
    expect(
      folderSizeSkips({ home: "/home/linux-user", platform: "linux" }).size,
    ).toBe(0);
  });
});
