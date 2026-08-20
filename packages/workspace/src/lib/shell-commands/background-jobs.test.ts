import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { runTool } from "../../test/helpers/run-tool";
import { BashTool } from "../../tools/bash";
import { killSessionBackgroundProcesses } from "../background-processes";

const model = createMockAIGatewayModel();

/**
 * Drives the job commands the way the agent reaches them: as shell commands
 * inside a real `bash` call, against a real subprocess.
 */
describe("background job commands", () => {
  let taskDirPath: string;
  let taskId: TaskId;
  let sessionId: StoreId.Session;

  beforeEach(async () => {
    const tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-cmd-"));
    taskDirPath = path.join(tasksDir, `01k${"cmd".padEnd(23, "0")}`);
    await fs.mkdir(path.join(taskDirPath, "work"), { recursive: true });
    taskId = createMockTaskConfigForDir(taskDirPath);
    sessionId = StoreId.newSessionId();
    await fs.writeFile(
      path.join(taskDirPath, "work", "tick.js"),
      'setInterval(() => console.log("tick"), 100);\n',
      "utf8",
    );
  });

  afterEach(async () => {
    await killSessionBackgroundProcesses(sessionId);
    await fs.rm(path.dirname(taskDirPath), { force: true, recursive: true });
  });

  async function bash(command: string, yieldMs = 30_000) {
    const result = await runTool(BashTool, {
      agentName: "main" as const,
      input: { command, yieldMs },
      model,
      sessionId,
      signal: new AbortController().signal,
      spawnAgent: vi.fn(),
      taskId,
      taskState: {},
    });
    return result._unsafeUnwrap();
  }

  async function startTicker() {
    const started = await bash("node work/tick.js", 500);
    return started.processId ?? "";
  }

  it("lists nothing before anything has been promoted", async () => {
    const listed = await bash("jobs");
    expect(listed.output).toContain("No background processes.");
    expect(listed.exitCode).toBe(0);
  }, 30_000);

  it("lists a running process and survives across calls", async () => {
    const processId = await startTicker();

    // A separate `bash` call: shell state does not carry across calls, but the
    // registry does, which is the whole point of the command.
    const listed = await bash("jobs");
    expect(listed.output).toContain(processId);
    expect(listed.output).toContain("running");
    expect(listed.output).toContain("node work/tick.js");
  }, 30_000);

  it("composes with a pipeline so filtering happens before the output is paid for", async () => {
    const processId = await startTicker();

    // A real window rather than a snapshot: the ticker emits every 100ms, and
    // the promoting call already drained whatever had arrived by then.
    const filtered = await bash(`fg ${processId} --timeout 400 | rg -c tick`);
    expect(filtered.exitCode).toBe(0);
    // Just the count, not the ticks themselves.
    expect(filtered.output.trim()).toMatch(/^\d+$/);
  }, 30_000);

  it("bounds an open-ended wait by the call it is running inside", async () => {
    const processId = await startTicker();

    // No `--timeout`, on a process that never exits, inside a short call. Left
    // to its own ten-minute default the wait would outlive the call and be
    // promoted itself, answering with a second process id instead of output.
    const waited = await bash(`fg ${processId}`, 3000);
    expect(waited.processId).toBeUndefined();
    expect(waited.output).toContain(`${processId} is still running`);
    expect(waited.exitCode).toBe(0);
  }, 30_000);

  it("lowers an explicit timeout to what the call has left", async () => {
    const processId = await startTicker();

    // Asking for ten minutes inside a two-second call is the same trap wearing
    // an argument, so the window still wins.
    const waited = await bash(`fg ${processId} --timeout 600000`, 2000);
    expect(waited.processId).toBeUndefined();
    expect(waited.output).toContain(`${processId} is still running`);
  }, 30_000);

  it("reports jobs as json for a machine to read", async () => {
    const processId = await startTicker();

    const listed = await bash("jobs --json");
    const parsed = JSON.parse(listed.output) as {
      id: string;
      status: string;
    }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(processId);
    expect(parsed[0]?.status).toBe("running");
  }, 30_000);

  it("accepts a %n job spec and a signal flag the way a shell would", async () => {
    const processId = await startTicker();
    const jobNumber = processId.replace("bg_", "");

    const killed = await bash(`kill -9 %${jobNumber}`);
    expect(killed.exitCode).toBe(0);
    expect(killed.output).toContain(`Stopped ${processId}`);
  }, 30_000);

  it("refuses a bare pid rather than reaching the machine's own processes", async () => {
    const killed = await bash("kill 12345");
    expect(killed.exitCode).not.toBe(0);
    expect(killed.output).toContain("not a background process id");
  }, 30_000);

  it("treats `wait` as `fg` rather than letting the builtin swallow it", async () => {
    const processId = await startTicker();

    // `wait` cannot be shadowed, and the builtin exits 0 with no output, which
    // reads as "finished, wrote nothing". The alias is what keeps the agent's
    // strongest prior from producing that answer.
    const waited = await bash(`wait ${processId} --timeout 0`);
    expect(waited.output).toContain(`${processId} is still running`);
  }, 30_000);

  it("stops several processes in one call", async () => {
    const first = await startTicker();
    const second = await startTicker();

    const before = await bash("jobs");
    expect(before.output).toContain(first);
    expect(before.output).toContain(second);

    // One call where the tool surface needed three.
    const killed = await bash(`kill ${first} ${second}`);
    expect(killed.exitCode).toBe(0);
    const after = await bash("jobs");
    expect(after.output).not.toContain("running");
  }, 30_000);

  // `fg bg_1 && pnpm test` is the idiom the description sells, so a process that
  // was stopped rather than finished must not read as success: the work the
  // chained command depends on was cut short. Interrupting the interpreter
  // usually leaves a real 124 behind, but a stop that never confirms leaves no
  // exit code at all, and that is the case a `?? 0` would have called success.
  it("fails a wait on a process that was stopped rather than finished", async () => {
    const processId = await startTicker();
    await bash(`kill ${processId}`);

    const waited = await bash(`fg ${processId}`);
    expect(waited.exitCode).not.toBe(0);

    const chained = await bash(`fg ${processId} && echo reached`);
    expect(chained.output).not.toContain("reached");
  }, 30_000);
});
