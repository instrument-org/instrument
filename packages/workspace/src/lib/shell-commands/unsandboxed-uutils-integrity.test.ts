import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { REVIEWED } from "./unsandboxed-uutils";
import {
  reviewedSha256,
  uutilsBinaryReviewed,
} from "./unsandboxed-uutils-integrity";

const dir = mkdtempSync(path.join(os.tmpdir(), "uutils-integrity-"));
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

describe("uutilsBinaryReviewed", () => {
  it("passes the binary its hash names, and not once it changes", () => {
    const file = path.join(dir, "coreutils");
    writeFileSync(file, "reviewed");
    const expected = sha256("reviewed");
    expect(uutilsBinaryReviewed(file, expected)).toBe(true);
    expect(uutilsBinaryReviewed(file, expected)).toBe(true);
    writeFileSync(file, "replaced, and longer");
    expect(uutilsBinaryReviewed(file, expected)).toBe(false);
    writeFileSync(file, "reviewed");
    expect(uutilsBinaryReviewed(file, expected)).toBe(true);
  });

  it("fails a missing binary and a target with no reviewed hash", () => {
    expect(uutilsBinaryReviewed(path.join(dir, "gone"), sha256(""))).toBe(
      false,
    );
    expect(reviewedSha256("/x/coreutils", "freebsd-x64")).toBeUndefined();
    expect(reviewedSha256("/x/find", "darwin-arm64")).toBeUndefined();
    expect(reviewedSha256("/x/grep.exe", "win32-x64")).toBe(
      REVIEWED.targets["win32-x64"].files.grep,
    );
  });

  /** What `uutils:download` vendored for this machine, if it ran. */
  const vendored = path.resolve(
    import.meta.dirname,
    "../../../../../apps/studio/resources/uutils",
    process.platform === "win32" ? "coreutils.exe" : "coreutils",
  );
  it.runIf(existsSync(vendored))("passes the coreutils Studio vendored", () => {
    expect(uutilsBinaryReviewed(vendored)).toBe(true);
  });
});
