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
export interface AgentBrowserAnswer {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * One answer for every run, or a function given each run's arguments, for a
 * command whose own follow-up reads the page more than once and reads
 * something different each time.
 */
export async function answerAgentBrowser(
  answer: AgentBrowserAnswer | ((args: string[]) => AgentBrowserAnswer),
): Promise<void> {
  const answerFor = (args: unknown): AgentBrowserAnswer =>
    typeof answer === "function"
      ? answer(Array.isArray(args) ? args.map(String) : [])
      : answer;
  const { execa } = await import("execa");
  // execa's result carries far more than a run of the CLI reads back, and
  // its subprocess more than the `exit` listener the command adds.
  vi.mocked(execa).mockImplementation(((...given: unknown[]) =>
    Object.assign(Promise.resolve(answerFor(given[1])), {
      once: () => undefined,
    })) as never);
  if (process.platform !== "win32") {
    return;
  }
  vi.mocked(spawn).mockImplementation((...given: unknown[]) => {
    const answered = answerFor(given[1]);
    const options = given[2];
    const stdio =
      typeof options === "object" && options !== null && "stdio" in options
        ? options.stdio
        : undefined;
    const streams: unknown[] = Array.isArray(stdio) ? stdio : [];
    const [, stdout, stderr] = streams;
    if (typeof stdout === "number") {
      writeSync(stdout, answered.stdout);
    }
    if (typeof stderr === "number") {
      writeSync(stderr, answered.stderr);
    }
    const child = new ChildProcess();
    setImmediate(() => child.emit("exit", answered.exitCode));
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
