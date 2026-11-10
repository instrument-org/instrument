import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FFMPEG_VERSION } from "./ffmpeg-release";
import {
  verifyFfmpegBinary,
  verifyFfmpegTree,
  verifyVersionBanner,
} from "./verify-ffmpeg";

/** What `ffmpeg:download` vendored for this machine. */
const FFMPEG_DIR = path.resolve(import.meta.dirname, "../resources/ffmpeg");
const exe = process.platform === "win32" ? ".exe" : "";
const binaries = {
  ffmpegPath: path.join(FFMPEG_DIR, "bin", `ffmpeg${exe}`),
  ffprobePath: path.join(FFMPEG_DIR, "bin", `ffprobe${exe}`),
};

describe("verifyFfmpegBinary", () => {
  it.each([
    { binaryPath: binaries.ffmpegPath, name: "ffmpeg" as const },
    { binaryPath: binaries.ffprobePath, name: "ffprobe" as const },
  ])(
    "accepts the installed $name and reports its version",
    ({ binaryPath, name }) => {
      const { size, version } = verifyFfmpegBinary(binaryPath, { name });
      expect(size).toBeGreaterThan(100_000);
      expect(version).toContain(`${name} version`);
    },
  );

  it("throws when the binary is missing", () => {
    expect(() =>
      verifyFfmpegBinary(path.join(tmpdir(), "definitely-not-here-ffmpeg"), {
        name: "ffmpeg",
      }),
    ).toThrow(/not found/);
  });

  it("throws when the binary is too small to be complete", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ffmpeg-verify-"));
    const truncated = path.join(dir, "ffmpeg");
    writeFileSync(truncated, "MZ not a real binary");
    expect(() => verifyFfmpegBinary(truncated, { name: "ffmpeg" })).toThrow(
      /expected a complete binary/,
    );
  });

  it("skips execution when execute is false but still size-checks", () => {
    const { version } = verifyFfmpegBinary(binaries.ffmpegPath, {
      execute: false,
      name: "ffmpeg",
    });
    expect(version).toBeUndefined();
  });
});

describe("verifyFfmpegTree", () => {
  const host = { arch: process.arch, platform: process.platform };

  it("accepts the vendored folder for this host", () => {
    expect(() => verifyFfmpegTree(FFMPEG_DIR, host)).not.toThrow();
  });

  it("throws when a file differs from the pin", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ffmpeg-tree-"));
    cpSync(FFMPEG_DIR, dir, { recursive: true, verbatimSymlinks: true });
    writeFileSync(path.join(dir, "bin", `ffprobe${exe}`), "x", { flag: "a" });
    expect(() => verifyFfmpegTree(dir, host)).toThrow(/is pinned to/);
  });

  it("throws when the folder is missing", () => {
    expect(() =>
      verifyFfmpegTree(path.join(tmpdir(), "definitely-not-here-ffmpeg"), host),
    ).toThrow(/ffmpeg not found/);
  });

  it("throws for a target with no build", () => {
    expect(() =>
      verifyFfmpegTree(FFMPEG_DIR, { arch: "ia32", platform: "win32" }),
    ).toThrow(/No ffmpeg build for win32-ia32/);
  });
});

describe("verifyVersionBanner", () => {
  const check = (banner: string) => () => {
    verifyVersionBanner({
      banner,
      binaryPath: "/packaged/ffmpeg",
      name: "ffmpeg",
    });
  };

  // The reason the version floor exists: an older binary passes every other
  // check we have, because the rest of the suite runs against the copy in
  // resources/ rather than the packaged tree.
  it("refuses a build too old to read HEIC", () => {
    expect(
      check("ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers"),
    ).toThrow(/required to read HEIC/);
  });

  it.each([
    "ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers",
    "ffmpeg version n7.1.1 Copyright (c) 2000-2025 the FFmpeg developers",
    "ffmpeg version 8.0-static Copyright (c) 2000-2026 the FFmpeg developers",
    // No readable version. Reported rather than refused: this catches a
    // downgrade, it does not police how a build names itself.
    "ffmpeg version git-2026-08-06-abcdef Copyright (c) the FFmpeg developers",
  ])("accepts %s", (banner) => {
    expect(check(banner)).not.toThrow();
  });

  it("refuses a banner from a different binary than the one expected", () => {
    expect(
      check(
        "ffprobe version 7.1 Copyright (c) 2007-2024 the FFmpeg developers",
      ),
    ).toThrow(/unexpected -version output/);
  });
});

describe("the ffmpeg system skill", () => {
  it("names the FFmpeg version the app ships", () => {
    const skill = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../packages/workspace/system-skills/ffmpeg/SKILL.md",
      ),
      "utf8",
    );
    expect(skill).toContain(`FFmpeg ${FFMPEG_VERSION},`);
  });
});
