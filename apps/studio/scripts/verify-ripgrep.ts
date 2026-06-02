// Guards against shipping a truncated/corrupt `rg.exe` (FP-1087). A partial
// download cached by `@vscode/ripgrep` produced a byte-truncated PE that passed
// signing but failed to spawn on Windows with EFTYPE / ERROR_BAD_EXE_FORMAT.
// We validate the binary both after install (CI) and after packaging (afterPack).
//
// Loaded as TS directly: electron-builder runs configs through jiti, and CI
// invokes this via the jiti CLI, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
      `ripgrep binary at ${binaryPath} is only ${size} bytes; expected a complete binary (>= ${MIN_BINARY_BYTES} bytes). Likely a truncated download.`,
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
      `ripgrep binary at ${binaryPath} failed to execute (${detail}). Likely a truncated or corrupt binary.`,
    );
  }

  if (!version.toLowerCase().includes("ripgrep")) {
    throw new Error(
      `ripgrep binary at ${binaryPath} produced unexpected --version output: ${version}`,
    );
  }

  return { size, version };
}

async function main() {
  const { rgPath } = await import("@vscode/ripgrep");
  const { size, version } = verifyRipgrepBinary(rgPath);
  console.log(
    `Verified ripgrep at ${rgPath} (${size} bytes): ${version ?? "size-only"}`,
  );
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
