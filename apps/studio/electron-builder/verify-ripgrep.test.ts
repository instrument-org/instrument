import { rgPath } from "@vscode/ripgrep";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifyRipgrepBinary } from "./verify-ripgrep";

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

  it("throws when the binary is too small to be complete", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rg-verify-"));
    const truncated = path.join(dir, "rg");
    writeFileSync(truncated, "MZ not a real binary");
    expect(() => verifyRipgrepBinary(truncated)).toThrow(
      /expected a complete binary/,
    );
  });

  it("skips execution when execute is false but still size-checks", () => {
    const { version } = verifyRipgrepBinary(rgPath, { execute: false });
    expect(version).toBeUndefined();
  });
});
