// Guards against shipping a missing, corrupt, or downgraded ffmpeg/ffprobe by
// asserting the binary exists, is a plausible size, and runs `-version`. Run
// from the afterPack hook against the packaged binary; electron-builder loads
// this TS directly via jiti, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const MIN_BINARY_BYTES = 10_000_000;

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
