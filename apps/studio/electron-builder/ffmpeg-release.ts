// The instrument-org/ffmpeg-build release Studio ships, and the hashes that pin
// it. scripts/download-ffmpeg.ts checks a download against them, and afterPack
// checks the packaged copy again before signing rewrites the bytes.

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

/** The ffmpeg-build release tag. */
export const FFMPEG_RELEASE = "2026.11.09";

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
    archive: "0879123c1d44f9c60170befaa8efc27a4c50e274bda82cfd6adc1e0521e7a345",
    tree: "cc92f2c5a9143c230ba00db9c89c16aa1de13a598175303a68820d0eb406bab6",
  },
  "darwin-x64": {
    archive: "bb32cc5be400fd9bb8c12875ea0085dd98d344f9bf8b2d3128a276f5e5d93b3e",
    tree: "79873a321da74b66c76eed0ac4a24f6187dddb32820f069176fac47cef0915ba",
  },
  "linux-arm64": {
    archive: "6d5d58fcd11e417238ddd6f5856858f9f6e4adcad9bad6f8dc9d5b2c41a1e4da",
    tree: "6d547466f94fdf43e06be007674c7477e10964ac09bef318d3c4f9494a01944b",
  },
  "linux-x64": {
    archive: "2fd3e53bb3efe509661108e829d8949db395ff2feaaa7e1a274e8b78e3d47e1b",
    tree: "27cc69fb4d1e594d9fe9cf59dd42a10ddcadad241828617327d19315f6ade7df",
  },
  "win32-arm64": {
    archive: "634c752d9f3a0be4bd9608c7811fa8c657f4557d4b50820a300790e13aee22d2",
    tree: "70f824e3270fe2a6f43576f4c92b039be6f2c16e1af4e6daab633543f1c04411",
  },
  "win32-x64": {
    archive: "916fa48251ac5405be2674d1b0b0670369be8a03848f2079debf5a4f23f29572",
    tree: "6672a9146487871334368c97c602a5838b06886f9c0633afa289552fde26b65a",
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
