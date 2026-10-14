import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  asidesOf,
  copyEntrySync,
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

describe("a partial copy an earlier run left", () => {
  it("goes before the entry is placed, whichever process left it", () => {
    const from = path.join(dir.path, "a", "photos");
    write(path.join(from, "beach.jpg"), "mine");
    const to = path.join(dir.path, "b", "photos");
    write(path.join(`${to}.partial-99999`, "beach.jpg"), "cut short");
    write(path.join(dir.path, "b", "photos.partial-notes.txt"), "theirs");
    acrossVolumes(from);

    moveEntrySync(from, to);

    expect(fs.readdirSync(path.join(dir.path, "b")).toSorted()).toEqual([
      "photos",
      "photos.partial-notes.txt",
    ]);
    expect(listing(to)).toEqual(["beach.jpg"]);
  });
});

/** Sets an extended attribute as Finder does a tag, with the system's own tool. */
function setAttribute(entry: string, name: string, value: string) {
  execFileSync("/usr/bin/xattr", ["-w", name, value, entry]);
}

function attribute(entry: string, name: string) {
  return execFileSync("/usr/bin/xattr", ["-p", name, entry], {
    encoding: "utf8",
  }).trim();
}

// A move across volumes is a copy, and Node's copies drop extended
// attributes: a Finder tag, where a download came from, a resource fork.
describe.runIf(process.platform === "darwin")(
  "extended attributes across volumes",
  () => {
    const TAG = "com.instrument.test-tag";

    it("copies them on a file and a folder, links staying links", () => {
      const from = path.join(dir.path, "a", "work");
      write(path.join(from, "report.md"), "mine");
      setAttribute(path.join(from, "report.md"), TAG, "red");
      setAttribute(from, TAG, "blue");
      fs.symlinkSync("report.md", path.join(from, "latest.md"));
      const to = path.join(dir.path, "b", "work");

      copyEntrySync(from, to);

      expect(attribute(path.join(to, "report.md"), TAG)).toBe("red");
      expect(attribute(to, TAG)).toBe("blue");
      expect(fs.readlinkSync(path.join(to, "latest.md"))).toBe("report.md");
    });

    it("keeps them through a move to a second volume", () => {
      const image = path.join(dir.path, "volume.dmg");
      const volume = path.join(dir.path, "volume");
      execFileSync("/usr/bin/hdiutil", [
        "create",
        "-size",
        "8m",
        "-fs",
        "APFS",
        "-volname",
        "MoveTest",
        "-quiet",
        "-o",
        image,
      ]);
      execFileSync("/usr/bin/hdiutil", [
        "attach",
        image,
        "-nobrowse",
        "-mountpoint",
        volume,
        "-quiet",
      ]);
      try {
        const from = path.join(dir.path, "Downloads", "invoice.pdf");
        write(from, "pdf");
        setAttribute(from, TAG, "red");

        moveEntrySync(from, path.join(volume, "invoice.pdf"));

        expect(fs.existsSync(from)).toBe(false);
        expect(attribute(path.join(volume, "invoice.pdf"), TAG)).toBe("red");
      } finally {
        execFileSync("/usr/bin/hdiutil", ["detach", volume, "-quiet"]);
      }
    });
  },
);

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
