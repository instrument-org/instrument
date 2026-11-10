// The instrument-org/ffmpeg-build release Studio ships, and the hashes that pin
// it. scripts/download-ffmpeg.ts checks a download against them, and afterPack
// checks the packaged copy again before signing rewrites the bytes.

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

/** The ffmpeg-build release tag. */
export const FFMPEG_RELEASE = "2026.11.10";

/** The FFmpeg version that release builds, which the packaged binary reports. */
export const FFMPEG_VERSION = "9.0.2";

export type FfmpegTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-arm64"
  | "win32-x64";

/**
 * Per target: the release archive's SHA-256 as published, and `tree`, the
 * `ffmpegTreeSha256` of what it unpacks to. A release asset can be replaced
 * under the same tag, so both are pinned here; a new release fails both
 * checks until this table is refreshed from its SHA256SUMS and a download.
 */
export const FFMPEG_SHA256: Record<
  FfmpegTarget,
  { archive: string; tree: string }
> = {
  "darwin-arm64": {
    archive: "e9811063327e5cbe7fe9993297c79641d5856639cdd7f2040dbd29342e6060c4",
    tree: "47c96064e2ea87ad55dd3e6b52c4573e4366278891a7b2a403b750da766bb083",
  },
  "darwin-x64": {
    archive: "31751f89b549fa6a2e779525eaf6064659d1133c2d005f3193636875de200cca",
    tree: "b628b28d8b752a17f59a813884c793274585cf92dd5388899f4fe0c0586d09b8",
  },
  "linux-arm64": {
    archive: "f944f8146cb46b02cf950dcc9e320297324fa67f7af198d381c3f00ba6e4bcc5",
    tree: "1203f3be404235ba5bf561bf0138c3f349585da3a1a8964931ea328eb624de1a",
  },
  "linux-x64": {
    archive: "a31fcc6d5e697ea0b49878ca558098a65f212c9fb8ed24c4e5a9d909417edc01",
    tree: "571c943fb4023ce1b8afdc0b8e88375b525601b722653438feee5b2b8657db88",
  },
  "win32-arm64": {
    archive: "0f9c90f8d01da955ee20e58a6d09ade5578fe31812d02ddcb10fa0c370b623a2",
    tree: "d1e7a4bc35674b73d76384e7038eed7c219fb1e8947e7bcac9788cda78e2d620",
  },
  "win32-x64": {
    archive: "c5e45809f563fd4a7a7b52a2c3951a4883da1b4048e652b28e0a7e74ac8a40e3",
    tree: "572ced0c26bd5366d5fe15a4f5be6721b64a30d8bba5e5cb0f667b02d6a5e01d",
  },
};

export function ffmpegTarget(platform: string, arch: string): FfmpegTarget {
  const target = `${platform}-${arch}`;
  if (!Object.hasOwn(FFMPEG_SHA256, target)) {
    throw new Error(`No ffmpeg build for ${target}`);
  }
  // Checked against the table's keys just above.
  return target as FfmpegTarget;
}

/**
 * One SHA-256 over the programs and libraries the app runs: every file under
 * `bin/` and `lib/`, by its path and its own hash, in sorted order. A symlink
 * counts by where it points.
 */
export function ffmpegTreeSha256(dir: string): string {
  const entries: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(dir, relative);
    for (const name of readdirSync(full).toSorted()) {
      const child = path.posix.join(relative, name);
      const stat = lstatSync(path.join(dir, child));
      if (stat.isDirectory()) {
        walk(child);
      } else if (stat.isSymbolicLink()) {
        entries.push(`${child} -> ${readlinkSync(path.join(dir, child))}`);
      } else {
        const hash = createHash("sha256")
          .update(readFileSync(path.join(dir, child)))
          .digest("hex");
        entries.push(`${child} ${hash}`);
      }
    }
  };
  for (const top of ["bin", "lib"]) {
    if (readdirSync(dir).includes(top)) {
      walk(top);
    }
  }
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}
