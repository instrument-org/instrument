import { ChildProcess, spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { vi } from "vitest";

/**
 * Answers every run of the agent-browser CLI, and reads back what each was
 * started with. The command starts the CLI through execa on macOS and Linux,
 * and through `spawn` on Windows, where its output goes to files; each is
 * answered where this platform starts it. A test file using these mocks
 * `execa`, and `node:child_process` with `spawn` passing through to the real
 * one until it is answered here.
 */
export async function answerAgentBrowser(answer: {
  exitCode: number;
  stderr: string;
  stdout: string;
}): Promise<void> {
  const { execa } = await import("execa");
  // execa's result carries far more than a run of the CLI reads back.
  vi.mocked(execa).mockResolvedValue(answer as never);
  if (process.platform !== "win32") {
    return;
  }
  vi.mocked(spawn).mockImplementation((...given: unknown[]) => {
    const options = given[2];
    const stdio =
      typeof options === "object" && options !== null && "stdio" in options
        ? options.stdio
        : undefined;
    const streams: unknown[] = Array.isArray(stdio) ? stdio : [];
    const [, stdout, stderr] = streams;
    if (typeof stdout === "number") {
      writeSync(stdout, answer.stdout);
    }
    if (typeof stderr === "number") {
      writeSync(stderr, answer.stderr);
    }
    const child = new ChildProcess();
    setImmediate(() => child.emit("exit", answer.exitCode));
    return child;
  });
}

/** The arguments and environment of each run of the CLI, in order. */
export async function agentBrowserRuns(): Promise<
  { args: string[]; env: Record<string, string | undefined> }[]
> {
  const { execa } = await import("execa");
  const calls: unknown[][] =
    process.platform === "win32"
      ? vi.mocked(spawn).mock.calls.map((call) => [...call])
      : vi.mocked(execa).mock.calls.map((call) => [...call]);
  return calls.map(([, args, options]) => {
    const env =
      typeof options === "object" && options !== null && "env" in options
        ? options.env
        : undefined;
    return {
      args: Array.isArray(args) ? args.map(String) : [],
      env:
        typeof env === "object" && env !== null
          ? Object.fromEntries(
              Object.entries(env).map(([key, value]) => [
                key,
                typeof value === "string" ? value : undefined,
              ]),
            )
          : {},
    };
  });
}
