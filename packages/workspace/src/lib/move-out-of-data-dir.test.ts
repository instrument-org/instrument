import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { moveOutOfDataDir } from "./move-out-of-data-dir";

/**
 * The rule every one of the person's folders comes out of `.instrument/` by.
 * Each caller's own test covers its resolver and its callers; what is here is
 * the rule itself, and above all the one case real installs turn out to be
 * full of: the folder at the top level is already there and empty.
 */

let root: string;
const hidden = () => path.join(root, ".instrument", "skills");
const visible = () => path.join(root, "Skills");

async function writeSkill(dir: string, name: string): Promise<void> {
  await fs.mkdir(path.join(dir, name), { recursive: true });
  await fs.writeFile(path.join(dir, name, "SKILL.md"), `---\n${name}\n---\n`);
}

const move = () =>
  moveOutOfDataDir({ from: hidden(), name: "Skills", rootDir: root });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "move-out-of-data-dir-"));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("moveOutOfDataDir", () => {
  it("brings the whole folder out when the top level has none", async () => {
    await writeSkill(hidden(), "tidy-notes");

    expect(await move()).toEqual({
      count: 1,
      kind: "moved",
      left: 0,
      where: visible(),
    });
    expect(await fs.readdir(visible())).toEqual(["tidy-notes"]);
    await expect(fs.readdir(hidden())).rejects.toThrow();
  });

  it("moves into an empty folder of that name rather than leaving it empty", async () => {
    // What a real install looks like: the app made `Skills/` on a launch of
    // its own, so a folder is there with nothing in it. Leaving the move at
    // "already there" would read the empty one and hide the skills for good.
    await writeSkill(hidden(), "tidy-notes");
    await writeSkill(hidden(), "read-receipts");
    await fs.mkdir(visible(), { recursive: true });

    expect(await move()).toEqual({
      count: 2,
      kind: "moved",
      left: 0,
      where: visible(),
    });
    expect((await fs.readdir(visible())).toSorted()).toEqual([
      "read-receipts",
      "tidy-notes",
    ]);
    await expect(fs.readdir(hidden())).rejects.toThrow();
  });

  it("counts a folder holding only what the Finder left as empty", async () => {
    await writeSkill(hidden(), "tidy-notes");
    await fs.mkdir(visible(), { recursive: true });
    await fs.writeFile(path.join(visible(), ".DS_Store"), "");

    expect(await move()).toEqual({
      count: 1,
      kind: "moved",
      left: 0,
      where: visible(),
    });
    expect((await fs.readdir(visible())).toSorted()).toEqual([
      ".DS_Store",
      "tidy-notes",
    ]);
  });

  it("brings out what is still hidden after something was saved at the top level", async () => {
    // A launch whose move failed, and a skill saved since: the folder at the
    // top level is no longer empty, and the hidden ones still come out.
    await writeSkill(hidden(), "tidy-notes");
    await writeSkill(hidden(), "read-receipts");
    await writeSkill(visible(), "theirs");

    expect(await move()).toEqual({
      count: 2,
      kind: "moved",
      left: 0,
      where: visible(),
    });
    expect((await fs.readdir(visible())).toSorted()).toEqual([
      "read-receipts",
      "theirs",
      "tidy-notes",
    ]);
    await expect(fs.readdir(hidden())).rejects.toThrow();
  });

  it("leaves a hidden entry whose name is taken, whole, and what took it untouched", async () => {
    await writeSkill(hidden(), "tidy-notes");
    await writeSkill(hidden(), "read-receipts");
    await fs.mkdir(path.join(visible(), "tidy-notes"), { recursive: true });
    await fs.writeFile(path.join(visible(), "tidy-notes", "SKILL.md"), "mine");

    expect(await move()).toEqual({
      count: 1,
      kind: "moved",
      left: 1,
      where: visible(),
    });
    expect(
      await fs.readFile(path.join(visible(), "tidy-notes", "SKILL.md"), "utf8"),
    ).toBe("mine");
    expect(await fs.readdir(hidden())).toEqual(["tidy-notes"]);
    expect(await move()).toEqual({
      kind: "already-there",
      left: 1,
      where: visible(),
    });
  });

  it("does nothing for a workspace with nothing hidden away", async () => {
    expect(await move()).toEqual({ kind: "none" });

    await fs.mkdir(hidden(), { recursive: true });
    expect(await move()).toEqual({ kind: "none" });
  });

  it("finds nothing to move on a second run", async () => {
    await writeSkill(hidden(), "tidy-notes");
    await move();

    expect(await move()).toEqual({ kind: "none" });
    expect(await fs.readdir(visible())).toEqual(["tidy-notes"]);
  });
});
