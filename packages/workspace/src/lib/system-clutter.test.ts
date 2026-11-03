import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isSystemClutter,
  MAC_CUSTOM_ICON,
  removeFolderLeftEmpty,
} from "./system-clutter";

// Whatever a draft's folder has that is not clutter goes with the message.
describe("isSystemClutter", () => {
  it.each([
    ".DS_Store",
    "._photo.jpg",
    "Thumbs.db",
    "desktop.ini",
    MAC_CUSTOM_ICON,
    "~$Report.docx",
    "movie.mp4.crdownload",
    "big.zip.part",
    "save.TMP",
  ])("treats %j as clutter", (name) => {
    expect(isSystemClutter(name)).toBe(true);
  });

  it.each(["Report.docx", "notes.tmp.md", "Icon.png", "part", "~draft.txt"])(
    "keeps %j, which a person made",
    (name) => {
      expect(isSystemClutter(name)).toBe(false);
    },
  );
});

// Removing a draft's folder after a send deletes what is in it, so anything
// that is not a file manager's own record must keep the folder.
describe("removeFolderLeftEmpty", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clutter-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("removes a folder left with only file manager records", () => {
    // Windows refuses a carriage return in a name, so the Mac's custom icon
    // record cannot be made there.
    const names = [".DS_Store", "._a", "desktop.ini"];
    if (process.platform !== "win32") names.push(MAC_CUSTOM_ICON);
    for (const name of names) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    expect(removeFolderLeftEmpty(dir)).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  // Clutter by name is not the same as safe to delete: a dotfile, a lock
  // file or a download in progress may be the person's.
  it.each([".env", "~$Report.docx", "movie.mp4.crdownload", "photo.jpg"])(
    "keeps the folder and its .DS_Store when %j is in it",
    (name) => {
      fs.writeFileSync(path.join(dir, ".DS_Store"), "");
      fs.writeFileSync(path.join(dir, name), "mine");
      expect(removeFolderLeftEmpty(dir)).toBe(false);
      expect(fs.readdirSync(dir).sort()).toEqual([".DS_Store", name].sort());
    },
  );

  it("answers false for a folder that is not there", () => {
    expect(removeFolderLeftEmpty(path.join(dir, "gone"))).toBe(false);
  });
});
