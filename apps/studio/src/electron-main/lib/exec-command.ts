import type { ForkOptions } from "node:child_process";

import { fork } from "node:child_process";

// Consider replacing with execa if it works the same
export async function forkExecCommand(
  modulePath: string,
  args?: string[],
  options?: ForkOptions,
  signal?: AbortSignal,
) {
  return new Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    // `fork`'s own signal handling covers an already-aborted signal (the child
    // is never spawned) and tears the listener down with the child. Hooking
    // `abort` by hand did neither.
    const child = fork(modulePath, args, {
      signal,
      stdio: "pipe",
      ...options,
    });

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // A child killed by a signal reports a null code; treating that as 0 made
      // it indistinguishable from a clean exit.
      resolve({ exitCode: code ?? 1, stderr, stdout });
    });

    // Must handle this error or Electron will show error window
    child.on("error", (err) => {
      reject(err);
    });
  });
}
