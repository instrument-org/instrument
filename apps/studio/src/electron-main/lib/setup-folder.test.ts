import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  homeRelativePath,
  makeOutputFolder,
  outputFolderForPick,
} from "./setup-folder";

describe("outputFolderForPick", () => {
  it.each([
    ["/Users/sam/Documents", "/Users/sam/Documents/Instrument"],
    ["/Users/sam/Documents/Instrument", "/Users/sam/Documents/Instrument"],
    ["/Volumes/Work", "/Volumes/Work/Instrument"],
  ])("%s stands for %s", (picked, folder) => {
    expect(outputFolderForPick(picked)).toBe(folder);
  });
});

describe("homeRelativePath", () => {
  it.each([
    ["/Users/sam/Documents/Instrument", "~/Documents/Instrument"],
    ["/Users/sam", "~"],
    ["/Users/samuel/Instrument", "/Users/samuel/Instrument"],
    ["/Volumes/Work/Instrument", "/Volumes/Work/Instrument"],
  ])("%s reads as %s", (folder, shown) => {
    expect(homeRelativePath(folder, "/Users/sam")).toBe(shown);
  });
});

describe("makeOutputFolder", () => {
  let root: string;
  let folderPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "setup-folder-"));
    folderPath = path.join(root, "Instrument");
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it("makes a folder that is not there", async () => {
    expect(await makeOutputFolder({ folderPath, keepExisting: false })).toEqual(
      { kind: "made" },
    );
    expect((await fs.stat(folderPath)).isDirectory()).toBe(true);
  });

  it("reports a folder with things in it, then keeps it once told to", async () => {
    await fs.mkdir(folderPath);
    await fs.writeFile(path.join(folderPath, "notes.md"), "");
    await fs.writeFile(path.join(folderPath, ".DS_Store"), "");
    expect(await makeOutputFolder({ folderPath, keepExisting: false })).toEqual(
      { items: 1, kind: "exists" },
    );
    expect(await makeOutputFolder({ folderPath, keepExisting: true })).toEqual({
      kind: "made",
    });
  });

  it("takes a folder holding only hidden files as empty", async () => {
    await fs.mkdir(folderPath);
    await fs.writeFile(path.join(folderPath, "Icon\r"), "");
    expect(await makeOutputFolder({ folderPath, keepExisting: false })).toEqual(
      { kind: "made" },
    );
  });
});
