import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { expectedUutils, verifyUutilsDir } from "./verify-uutils";

/** What `uutils:download` vendored for this machine, if it ran. */
const VENDORED = path.resolve(import.meta.dirname, "../resources/uutils");
const names = expectedUutils(process.platform);

describe("expectedUutils", () => {
  it.each([
    ["darwin", ["coreutils", "diffutils", "find", "grep", "xargs"]],
    ["linux", ["coreutils", "diffutils", "find", "grep", "xargs"]],
    [
      "win32",
      ["coreutils.exe", "diffutils.exe", "find.exe", "grep.exe", "xargs.exe"],
    ],
  ])("%s", (platform, expected) => {
    expect(expectedUutils(platform)).toEqual(expected);
  });
});

describe("verifyUutilsDir", () => {
  it.skipIf(!existsSync(path.join(VENDORED, names[0] ?? "")))(
    "runs each vendored binary",
    () => {
      expect(verifyUutilsDir(VENDORED, names)).toHaveLength(names.length);
    },
  );

  it("throws when a binary is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "uutils-verify-"));
    expect(() => verifyUutilsDir(dir, ["coreutils"])).toThrow(/not found/);
  });

  it("throws when a binary is too small to be complete", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "uutils-verify-"));
    writeFileSync(path.join(dir, "xargs"), "not a binary");
    expect(() => verifyUutilsDir(dir, ["xargs"], { execute: false })).toThrow(
      /expected a complete binary/,
    );
  });
});
