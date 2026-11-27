import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { folderWalkSkips, walkFolder } from "./folder-walk";

describe("walkFolder", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "folder-walk-")),
    );
    await fs.mkdir(path.join(root, "inner", "deeper"), { recursive: true });
    await fs.writeFile(path.join(root, "a.txt"), "12345");
    await fs.writeFile(path.join(root, "inner", "b.txt"), "123");
    await fs.writeFile(path.join(root, "inner", "deeper", "c.txt"), "12");
  });
  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  const shape = (walk: Awaited<ReturnType<typeof walkFolder>>) =>
    walk && {
      entries: walk.entries.map(
        ({ folder, isFolder, name, size, ...rest }) => ({
          folder,
          isFolder,
          name,
          size,
          ...(rest.package ? { package: rest.package } : {}),
        }),
      ),
      notSearched: walk.notSearched.map((at) => path.relative(root, at)),
      truncated: walk.truncated,
    };

  it("lists everything under the folder, nearest first", async () => {
    const walk = await walkFolder(root, { skips: new Set() });
    expect(shape(walk)).toMatchInlineSnapshot(`
      {
        "entries": [
          {
            "folder": "",
            "isFolder": false,
            "name": "a.txt",
            "size": 5,
          },
          {
            "folder": "",
            "isFolder": true,
            "name": "inner",
            "size": undefined,
          },
          {
            "folder": "inner",
            "isFolder": false,
            "name": "b.txt",
            "size": 3,
          },
          {
            "folder": "inner",
            "isFolder": true,
            "name": "deeper",
            "size": undefined,
          },
          {
            "folder": "inner/deeper",
            "isFolder": false,
            "name": "c.txt",
            "size": 2,
          },
        ],
        "notSearched": [],
        "truncated": false,
      }
    `);
    expect(walk?.entries[4]?.path).toBe(
      path.join(root, "inner", "deeper", "c.txt"),
    );
    expect(walk?.entries[0]?.modifiedAt).toBeGreaterThan(0);
  });

  it("leaves out dot names, node_modules and links", async () => {
    await fs.writeFile(path.join(root, ".hidden"), "x");
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, ".git", "HEAD"), "x");
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.symlink(path.join(root, "inner"), path.join(root, "link"));
    const walk = await walkFolder(root, { skips: new Set() });
    expect(walk?.entries.map((entry) => entry.name)).toEqual([
      "a.txt",
      "inner",
      "b.txt",
      "deeper",
      "c.txt",
    ]);
  });

  it("lists a package as a file without going into it", async () => {
    await fs.mkdir(path.join(root, "Tool.app", "Contents"), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, "Tool.app", "Contents", "x"), "x");
    const walk = await walkFolder(root, { skips: new Set() });
    expect(shape(walk)?.entries.filter((entry) => entry.package)).toEqual([
      { folder: "", isFolder: false, name: "Tool.app", package: true },
    ]);
    expect(walk?.entries.some((entry) => entry.name === "Contents")).toBe(
      false,
    );
  });

  it("lists a skipped folder and names it without going in", async () => {
    const walk = await walkFolder(root, {
      skips: new Set([path.join(root, "inner")]),
    });
    expect(shape(walk)).toMatchObject({
      entries: [{ name: "a.txt" }, { name: "inner" }],
      notSearched: ["inner"],
      truncated: false,
    });
  });

  it("stops at the cap, keeping the nearest entries", async () => {
    const walk = await walkFolder(root, { maxEntries: 3, skips: new Set() });
    expect(shape(walk)).toMatchObject({
      entries: [{ name: "a.txt" }, { name: "inner" }, { name: "b.txt" }],
      truncated: true,
    });
  });

  it("is complete when the cap is exactly what there is", async () => {
    const walk = await walkFolder(root, { maxEntries: 5, skips: new Set() });
    expect(walk?.truncated).toBe(false);
  });

  it("is null for a file or a missing folder", async () => {
    expect(await walkFolder(path.join(root, "a.txt"))).toBeNull();
    expect(await walkFolder(path.join(root, "missing"))).toBeNull();
  });

  it("throws once aborted", async () => {
    await expect(
      walkFolder(root, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  });
});

describe("folderWalkSkips", () => {
  it("steps over AppData from a Windows home folder", () => {
    const skips = folderWalkSkips({
      home: String.raw`C:\Users\windows-user`,
      platform: "win32",
    });
    expect([...skips]).toEqual([String.raw`C:\Users\windows-user\AppData`]);
    expect(
      folderWalkSkips({ home: "/Users/mac-user", platform: "darwin" }).has(
        "/Users/mac-user/AppData",
      ),
    ).toBe(false);
  });
});
