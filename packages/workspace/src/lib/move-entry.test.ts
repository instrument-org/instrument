import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  asidesOf,
  moveEntrySync,
  placeEntrySync,
  removeEntrySync,
} from "./move-entry";

const dir = withTempDir("move-entry");

afterEach(() => {
  vi.restoreAllMocks();
});

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Every file under a folder, not through links, sorted. */
function listing(at: string): string[] {
  return fs
    .readdirSync(at, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(at, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

/** As if `from` were on another volume than wherever it is renamed to. */
function acrossVolumes(from: string) {
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (String(source) === from && !String(destination).includes(".moved-")) {
      throw Object.assign(new Error("cross-device link not permitted"), {
        code: "EXDEV",
      });
    }
    rename(source, destination);
  });
}

describe("moving across volumes", () => {
  it("copies links as links, and deletes the original's links, never what they point to", () => {
    const outside = path.join(dir.path, "outside");
    write(path.join(outside, "skill", "SKILL.md"), "theirs");
    write(path.join(outside, "file.txt"), "theirs");
    const from = path.join(dir.path, "a", "work");
    write(path.join(from, "report.md"), "mine");
    fs.mkdirSync(path.join(from, "nested"), { recursive: true });
    fs.symlinkSync(path.join(outside, "skill"), path.join(from, "skill"));
    fs.symlinkSync(
      path.join(outside, "file.txt"),
      path.join(from, "nested", "file.txt"),
    );
    const to = path.join(dir.path, "b", "work");
    acrossVolumes(from);

    moveEntrySync(from, to);

    expect(fs.existsSync(from)).toBe(false);
    expect(asidesOf(from)).toEqual([]);
    expect(fs.lstatSync(path.join(to, "skill")).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(to, "skill"))).toBe(
      path.join(outside, "skill"),
    );
    expect(
      fs.lstatSync(path.join(to, "nested", "file.txt")).isSymbolicLink(),
    ).toBe(true);
    expect(fs.readFileSync(path.join(to, "report.md"), "utf8")).toBe("mine");
    expect(listing(outside)).toEqual([
      "file.txt",
      path.join("skill", "SKILL.md"),
    ]);
  });

  it("moves a link that is the whole entry as a link", () => {
    const outside = path.join(dir.path, "outside");
    write(path.join(outside, "keep.txt"), "theirs");
    const from = path.join(dir.path, "a", "tasks");
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.symlinkSync(outside, from);
    const to = path.join(dir.path, "b", "tasks");
    acrossVolumes(from);

    expect(placeEntrySync(from, to)).toBe("copied");
    moveEntrySync(from, path.join(dir.path, "c", "tasks"));

    expect(fs.readlinkSync(to)).toBe(outside);
    expect(fs.existsSync(from)).toBe(false);
    expect(listing(outside)).toEqual(["keep.txt"]);
  });
});

describe("removeEntrySync", () => {
  it("unlinks a link to a folder, leaving the folder", () => {
    const outside = path.join(dir.path, "outside");
    write(path.join(outside, ".venv", "bin", "python"), "theirs");
    const link = path.join(dir.path, "chat", ".venv");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(outside, ".venv"), link);

    removeEntrySync(link);

    expect(fs.existsSync(link)).toBe(false);
    expect(listing(outside)).toEqual([path.join(".venv", "bin", "python")]);
  });

  it("deletes a folder, and a link inside it without following it", () => {
    const outside = path.join(dir.path, "outside");
    write(path.join(outside, "keep.txt"), "theirs");
    const folder = path.join(dir.path, "chat", "node_modules");
    write(path.join(folder, "x.js"));
    fs.symlinkSync(outside, path.join(folder, "linked"));

    removeEntrySync(folder);

    expect(fs.existsSync(folder)).toBe(false);
    expect(listing(outside)).toEqual(["keep.txt"]);
  });
});
