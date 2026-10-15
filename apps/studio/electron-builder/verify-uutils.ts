// Guards against shipping without the uutils binaries the agent's shell runs
// for its GNU text commands: each one scripts/download-uutils.ts vendors for
// the target exists, is a plausible size, and, where the build host can run
// it, answers `--version`. Without them the shell falls back to its own
// commands silently, so a missing file would never show up as an error.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const MIN_BINARY_BYTES = 200_000;

/** The binaries a target carries, as download-uutils.ts vendors them. */
export function expectedUutils(platform: string, arch: string): string[] {
  const names =
    platform !== "win32"
      ? ["coreutils", "diffutils", "find", "grep", "xargs"]
      : arch === "arm64"
        ? ["coreutils"]
        : ["coreutils", "diffutils", "xargs"];
  return names.map((name) => (platform === "win32" ? `${name}.exe` : name));
}

export function verifyUutilsDir(
  dir: string,
  names: string[],
  { execute = true }: { execute?: boolean } = {},
) {
  const verified: string[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      throw new Error(
        `uutils binary not found at ${file}. Run \`pnpm --filter @instrument-org/studio uutils:download\` before packaging.`,
      );
    }
    const { size } = statSync(file);
    if (size < MIN_BINARY_BYTES) {
      throw new Error(
        `uutils binary at ${file} is only ${size} bytes; expected a complete binary.`,
      );
    }
    if (execute) {
      // A multicall binary needs the utility to answer for, and diffutils'
      // cmp has no `--version`, so it compares the binary with itself.
      const args = name.startsWith("coreutils")
        ? ["sort", "--version"]
        : name.startsWith("diffutils")
          ? ["cmp", file, file]
          : ["--version"];
      try {
        execFileSync(file, args, { encoding: "utf8", stdio: "pipe" });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`uutils binary at ${file} failed to run (${detail}).`);
      }
    }
    verified.push(`${name} ${size}`);
  }
  return verified;
}
