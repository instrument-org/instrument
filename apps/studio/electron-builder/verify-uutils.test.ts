import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { expectedUutils, verifyUutilsDir } from "./verify-uutils";

/** What `uutils:download` vendored for this machine, if it ran. */
const VENDORED = path.resolve(import.meta.dirname, "../resources/uutils");
const names = expectedUutils(process.platform, process.arch);

describe("expectedUutils", () => {
  it.each([
    ["darwin", "arm64", ["coreutils", "diffutils", "find", "grep", "xargs"]],
    ["linux", "x64", ["coreutils", "diffutils", "find", "grep", "xargs"]],
    ["win32", "x64", ["coreutils.exe", "diffutils.exe"]],
    ["win32", "arm64", ["coreutils.exe"]],
  ])("%s %s", (platform, arch, expected) => {
    expect(expectedUutils(platform, arch)).toEqual(expected);
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
