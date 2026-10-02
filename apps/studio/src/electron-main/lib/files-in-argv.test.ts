import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { filesInArgv } from "./files-in-argv";

const root = mkdtempSync(path.join(tmpdir(), "files-in-argv-"));
const notes = path.join(root, "notes.md");
const folder = path.join(root, "folder");
writeFileSync(notes, "# Notes");
mkdirSync(folder);

describe("filesInArgv", () => {
  it("returns the file a packaged launch was handed", () => {
    expect(
      filesInArgv(["C:\\Instrument\\Instrument.exe", notes], {
        defaultApp: false,
      }),
    ).toEqual([notes]);
  });

  it("skips the app path a launch from source carries", () => {
    expect(
      filesInArgv(["/electron", notes, notes], { defaultApp: true }),
    ).toEqual([notes]);
  });

  it("reads a file URL, which the Linux desktop entry hands over", () => {
    expect(
      filesInArgv(["/app", pathToFileURL(notes).href], { defaultApp: false }),
    ).toEqual([notes]);
  });

  it.each([
    ["a switch", "--allow-file-access-from-files"],
    ["a deep link", "instrument://skill/research"],
    ["a folder", folder],
    ["a missing file", path.join(root, "gone.md")],
    ["a relative path", "notes.md"],
    ["a URL that is not a file's", "file://server/share/notes.md"],
  ])("skips %s", (_label, arg) => {
    expect(filesInArgv(["/app", arg], { defaultApp: false })).toEqual([]);
  });
});
