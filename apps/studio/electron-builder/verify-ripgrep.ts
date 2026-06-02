// Guards against shipping a truncated/corrupt `rg.exe` (FP-1087). A partial
// download cached by `@vscode/ripgrep` produced a byte-truncated PE that passed
// signing but failed to spawn on Windows with EFTYPE / ERROR_BAD_EXE_FORMAT.
// We validate the binary both after install (CI) and after packaging (afterPack).
//
// Loaded as TS directly: electron-builder runs configs through jiti, and CI
// invokes this via the jiti CLI, so no separate compile step is needed.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN_BINARY_BYTES = 1_000_000;

/**
 * Whether this module is the process entrypoint. Compares the resolved module
 * path to `argv[1]`, ignoring path-separator and extension differences. The
 * jiti CLI (used by CI to run this as `.ts`) rewrites `argv[1]` with forward
 * slashes on Windows while `import.meta.url` resolves with backslashes, so a
 * naive `===` comparison silently skips `main()` and the guard becomes a no-op.
 */
export function isEntrypoint(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argv1) {
    return false;
  }

  const entry = path.resolve(argv1);
  const self = path.resolve(fileURLToPath(moduleUrl));
  if (entry === self) {
    return true;
  }

  // jiti may hand us the source `.ts` path while `import.meta.url` points at a
  // transpiled/cached file (or vice versa); fall back to a basename match in
  // the same directory so the entrypoint check survives that rewrite.
  const stripExt = (p: string) => p.slice(0, p.length - path.extname(p).length);
  return path.dirname(entry) === path.dirname(self)
    ? stripExt(entry) === stripExt(self)
    : false;
}

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

const isDirectRun = isEntrypoint(process.argv[1], import.meta.url);

if (isDirectRun) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
