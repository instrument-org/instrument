// Guards against shipping a missing, corrupt, or downgraded ffmpeg/ffprobe by
// asserting the folder is the pinned release and each program runs `-version`.
// Run from the afterPack hook against the packaged binary; electron-builder
// loads this TS directly via jiti, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

import {
  FFMPEG_RELEASE,
  FFMPEG_SHA256,
  ffmpegTarget,
  ffmpegTreeSha256,
} from "./ffmpeg-release";

// A Linux or Windows build keeps FFmpeg's libraries beside the programs, so
// the programs themselves are small.
const MIN_BINARY_BYTES = 100_000;

/**
 * Assert that the packaged ffmpeg folder is byte-for-byte what the pinned
 * release unpacks to. Runs before signing, which rewrites the Mach-O
 * signature and with it the hash.
 */
export function verifyFfmpegTree(
  dir: string,
  { arch, platform }: { arch: string; platform: string },
) {
  const target = ffmpegTarget(platform, arch);
  if (!existsSync(dir)) {
    throw new Error(
      `ffmpeg not found at ${dir}. It has to reach app.asar.unpacked, since every image and video read spawns it; run \`pnpm --filter @instrument-org/studio ffmpeg:download\` before packaging.`,
    );
  }
  const expected = FFMPEG_SHA256[target].tree;
  const actual = ffmpegTreeSha256(dir);
  if (actual !== expected) {
    throw new Error(
      `ffmpeg at ${dir} hashes to ${actual}, but ${target} of ffmpeg-build ${FFMPEG_RELEASE} is pinned to ${expected}. Run \`pnpm --filter @instrument-org/studio ffmpeg:download\` before packaging, and refresh FFMPEG_SHA256 in ffmpeg-release.ts only for a new release.`,
    );
  }
}

/**
 * The oldest ffmpeg that reads the images users actually attach.
 *
 * HEIF/HEIC arrived in 7.1: before it, an iPhone photo is an unknown container
 * and the whole image pipeline drops it. A build that quietly picked up an
 * older binary would pass every test we have, since the tests run against
 * the copy in resources/ rather than the packaged tree.
 */
const MIN_MAJOR_VERSION = 7;

/**
 * Assert that an ffmpeg or ffprobe binary at the given path exists and is
 * plausibly complete. When `execute` is true (default) it also runs `-version`
 * and checks the major version. Cross-arch packaging passes `execute: false`
 * since a binary for a different arch cannot run on the build host.
 */
export function verifyFfmpegBinary(
  binaryPath: string,
  { execute = true, name }: { execute?: boolean; name: "ffmpeg" | "ffprobe" },
) {
  if (!existsSync(binaryPath)) {
    throw new Error(`${name} binary not found at ${binaryPath}`);
  }

  const { size } = statSync(binaryPath);
  if (size < MIN_BINARY_BYTES) {
    throw new Error(
      `${name} binary at ${binaryPath} is only ${size} bytes; expected a complete binary (>= ${MIN_BINARY_BYTES} bytes).`,
    );
  }

  if (!execute) {
    return { size, version: undefined };
  }

  let version: string;
  try {
    // `-version` writes the banner to stdout and exits 0.
    const output = execFileSync(binaryPath, ["-version"], {
      encoding: "utf8",
    });
    version = (output.split("\n")[0] ?? "").trim();
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${name} binary at ${binaryPath} failed to execute (${detail}). Likely a corrupt binary.`,
    );
  }

  verifyVersionBanner({ banner: version, binaryPath, name });

  return { size, version };
}

/**
 * Check the first line of a `-version` banner: that it came from the binary we
 * think it did, and that the build is new enough.
 *
 * A build is free to describe itself however it likes -- a git hash and a
 * distribution suffix are both common -- so a banner carrying no readable
 * version passes rather than failing. This exists to catch a downgrade, not to
 * police how a build names itself.
 */
export function verifyVersionBanner({
  banner,
  binaryPath,
  name,
}: {
  banner: string;
  binaryPath: string;
  name: "ffmpeg" | "ffprobe";
}) {
  if (!banner.toLowerCase().startsWith(name)) {
    throw new Error(
      `${name} binary at ${binaryPath} produced unexpected -version output: ${banner}`,
    );
  }

  const match = /version n?(\d+)\./.exec(banner);
  const major = match?.[1] === undefined ? undefined : Number(match[1]);
  if (major !== undefined && major < MIN_MAJOR_VERSION) {
    throw new Error(
      `${name} binary at ${binaryPath} is version ${major}.x; ${MIN_MAJOR_VERSION}.1 or newer is required to read HEIC. Got: ${banner}`,
    );
  }
}
