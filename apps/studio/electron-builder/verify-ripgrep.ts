// Guards against shipping a missing or corrupt ripgrep binary (FP-1087) by
// asserting it exists, is a plausible size, and runs `--version`. Run from the
// electron-builder afterPack hook against the packaged binary; electron-builder
// loads this TS directly via jiti, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const MIN_BINARY_BYTES = 1_000_000;

/**
 * Assert that a ripgrep binary at the given path exists and is plausibly
 * complete. When `execute` is true (default) it also runs `--version` to prove
 * the binary actually loads. Cross-arch packaging passes `execute: false` since
 * a complete binary for a different arch cannot run on the build host.
 */
export function verifyRipgrepBinary(
  binaryPath: string,
  { execute = true }: { execute?: boolean } = {},
) {
  if (!existsSync(binaryPath)) {
    throw new Error(`ripgrep binary not found at ${binaryPath}`);
  }

  const { size } = statSync(binaryPath);
  if (size < MIN_BINARY_BYTES) {
    throw new Error(
      `ripgrep binary at ${binaryPath} is only ${size} bytes; expected a complete binary (>= ${MIN_BINARY_BYTES} bytes).`,
    );
  }

  if (!execute) {
    return { size, version: undefined };
  }

  let version: string;
  try {
    version = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
    }).trim();
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ripgrep binary at ${binaryPath} failed to execute (${detail}). Likely a corrupt binary.`,
    );
  }

  if (!version.toLowerCase().includes("ripgrep")) {
    throw new Error(
      `ripgrep binary at ${binaryPath} produced unexpected --version output: ${version}`,
    );
  }

  return { size, version };
}
