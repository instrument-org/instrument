// Guards against shipping no agent-browser binary, or one that cannot run, by
// asserting it is a plausible size and that `--version` names agent-browser.
// Run from the electron-builder afterPack hook against the packaged binary;
// electron-builder loads this TS directly via jiti.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const MIN_BINARY_BYTES = 1_000_000;

/**
 * Assert that the agent-browser binary at `binaryPath` is plausibly complete
 * and, when `execute` is true (default), that it runs. Cross-arch packaging
 * passes `execute: false`, since a binary for another arch cannot run here.
 */
export function verifyAgentBrowserBinary(
  binaryPath: string,
  { execute = true }: { execute?: boolean } = {},
) {
  const { size } = statSync(binaryPath);
  if (size < MIN_BINARY_BYTES) {
    throw new Error(
      `agent-browser binary at ${binaryPath} is only ${size} bytes; expected a complete binary (>= ${MIN_BINARY_BYTES} bytes).`,
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
      `agent-browser binary at ${binaryPath} failed to execute (${detail}).`,
    );
  }
  if (!version.startsWith("agent-browser ")) {
    throw new Error(
      `agent-browser binary at ${binaryPath} produced unexpected --version output: ${version}`,
    );
  }
  return { size, version };
}
