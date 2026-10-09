// Guards against shipping a missing, corrupt, or downgraded ffmpeg/ffprobe by
// asserting the binary exists, is a plausible size, and runs `-version`. Run
// from the afterPack hook against the packaged binary; electron-builder loads
// this TS directly via jiti, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

const MIN_BINARY_BYTES = 10_000_000;

/**
 * SHA-256 of every binary `ffmpeg-ffprobe-static` 7.1.0-rc.1 downloads, by
 * `<name>-<platform>-<arch>`, the release asset names.
 *
 * Its install script fetches them from a GitHub release with no checksum, and
 * a release asset can be replaced under the same tag, so the packaged bytes are
 * pinned here. A package bump fails this check until the table is refreshed
 * from the new release's assets.
 */
const FFMPEG_SHA256: Record<string, string> = {
  "ffmpeg-darwin-arm64":
    "6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617",
  "ffmpeg-darwin-x64":
    "4a4a968b98859588e98500ae25973d80a5ca5eed0724222b9f76360dcb72a001",
  "ffmpeg-linux-arm64":
    "6445302f6633da63792a1a6de375dfa8c3612ce2c963a98b642d2a2f3218450b",
  "ffmpeg-linux-x64":
    "9011e412b63928c4b4a35fedb15c689e94719359d00c461b2bb5e8d02599bb5d",
  "ffmpeg-win32-x64":
    "2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3",
  "ffprobe-darwin-arm64":
    "df2684842eca145bd72f4724ce9cecbf38558a4d64b2aef7846680f877702baa",
  "ffprobe-darwin-x64":
    "ce5414269f0efa1e88b5e23b57f801d5b9a40be554716544936e0332b4601a62",
  "ffprobe-linux-arm64":
    "a428fea7933cc5f3414bdb670df73c668d39eb6904926b3a7480bb2918193705",
  "ffprobe-linux-x64":
    "74f18f3728e3aed5c3b06e102c2126192bcdf69858d2f29a2bc7fd728b34cb7e",
  "ffprobe-win32-x64":
    "436bf02524d50135ed9965b90d1e0ad7f26c5c236132613a2edb87ef8b6873d0",
};

/**
 * Assert that a packaged ffmpeg or ffprobe is byte-for-byte the release asset
 * pinned for its platform and arch. Runs before signing, which rewrites the
 * Mach-O signature and with it the hash.
 */
export function verifyFfmpegChecksum(
  binaryPath: string,
  {
    arch,
    name,
    platform,
  }: { arch: string; name: "ffmpeg" | "ffprobe"; platform: string },
) {
  const asset = `${name}-${platform}-${arch}`;
  const expected = FFMPEG_SHA256[asset];
  if (!expected) {
    throw new Error(
      `No pinned SHA-256 for ${asset}; add the release asset's hash to FFMPEG_SHA256 in verify-ffmpeg.ts.`,
    );
  }
  const actual = createHash("sha256")
    .update(readFileSync(binaryPath))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${name} binary at ${binaryPath} has SHA-256 ${actual}, but ${asset} is pinned to ${expected}. Either the download was tampered with or ffmpeg-ffprobe-static changed release; refresh FFMPEG_SHA256 only after checking the new assets.`,
    );
  }
}

/**
 * The oldest ffmpeg that reads the images users actually attach.
 *
 * HEIF/HEIC arrived in 7.1: before it, an iPhone photo is an unknown container
 * and the whole image pipeline drops it. A build that quietly picked up an
 * older binary would pass every test we have, since the tests run against
 * node_modules rather than the packaged tree.
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
