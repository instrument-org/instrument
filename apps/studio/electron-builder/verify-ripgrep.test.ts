import { rgPath } from "@vscode/ripgrep";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { isEntrypoint, verifyRipgrepBinary } from "./verify-ripgrep";

describe("verifyRipgrepBinary", () => {
  it("accepts the installed ripgrep binary and reports its version", () => {
    const { size, version } = verifyRipgrepBinary(rgPath);
    expect(size).toBeGreaterThan(1_000_000);
    expect(version?.toLowerCase()).toContain("ripgrep");
  });

  it("throws when the binary is missing", () => {
    expect(() =>
      verifyRipgrepBinary(path.join(tmpdir(), "definitely-not-here-rg.exe")),
    ).toThrow(/not found/);
  });

  it("throws when the binary is truncated (too small)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rg-verify-"));
    const truncated = path.join(dir, "rg");
    writeFileSync(truncated, "MZ not a real binary");
    expect(() => verifyRipgrepBinary(truncated)).toThrow(/truncated download/);
  });

  it("skips execution when execute is false but still size-checks", () => {
    const { version } = verifyRipgrepBinary(rgPath, { execute: false });
    expect(version).toBeUndefined();
  });
});

describe("isEntrypoint", () => {
  const moduleUrl = pathToFileURL(
    path.join(tmpdir(), "verify-ripgrep.ts"),
  ).href;

  it("matches when argv[1] is the module path", () => {
    const selfPath = path.join(tmpdir(), "verify-ripgrep.ts");
    expect(isEntrypoint(selfPath, moduleUrl)).toBe(true);
  });

  it("matches when jiti rewrites argv[1] with forward slashes (FP-1087)", () => {
    // Simulate the Windows + jiti CLI invocation that previously slipped past
    // a strict `===` check: forward-slash argv vs backslash module path.
    const forwardSlashArgv = path
      .join(tmpdir(), "verify-ripgrep.ts")
      .replaceAll("\\", "/");
    expect(isEntrypoint(forwardSlashArgv, moduleUrl)).toBe(true);
  });

  it("matches when argv[1] omits the extension", () => {
    const noExt = path.join(tmpdir(), "verify-ripgrep");
    expect(isEntrypoint(noExt, moduleUrl)).toBe(true);
  });

  it("does not match an unrelated entrypoint", () => {
    const other = path.join(tmpdir(), "some-other-script.ts");
    expect(isEntrypoint(other, moduleUrl)).toBe(false);
  });

  it("does not match a same-named file in a different directory", () => {
    const elsewhere = path.join(tmpdir(), "nested", "verify-ripgrep.ts");
    expect(isEntrypoint(elsewhere, moduleUrl)).toBe(false);
  });

  it("returns false when argv[1] is undefined", () => {
    expect(isEntrypoint(undefined, moduleUrl)).toBe(false);
  });
});
