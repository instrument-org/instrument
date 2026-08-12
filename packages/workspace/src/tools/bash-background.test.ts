import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { killSessionBackgroundProcesses } from "../lib/background-processes";
import { taskDir } from "../lib/task-dir-utils";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { BashTool } from "./bash";

const model = createMockAIGatewayModel();

/**
 * The only tests that put a real subprocess through the real interpreter.
 *
 * Everything else in this area drives a controllable double, which cannot catch
 * the failure mode that matters most here: the sink reads execa's merged output
 * stream directly, so a change to how that stream is obtained breaks streaming
 * while every doubled test keeps passing.
 */
describe("bash background processes, end to end", () => {
  let taskDirPath: string;
  let taskId: TaskId;
  let sessionId: StoreId.Session;

  beforeEach(async () => {
    const tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-e2e-"));
    // The task id is the directory name, so it must look like one.
    taskDirPath = path.join(tasksDir, `01k${"e2e".padEnd(23, "0")}`);
    await fs.mkdir(path.join(taskDirPath, "work"), { recursive: true });
    taskId = createMockTaskConfigForDir(taskDirPath);
    sessionId = StoreId.newSessionId();
  });

  afterEach(async () => {
    await killSessionBackgroundProcesses(sessionId);
    await fs.rm(path.dirname(taskDirPath), { force: true, recursive: true });
  });

  function toolOptions<TInput>(input: TInput) {
    return {
      agentName: "main" as const,
      input,
      model,
      sessionId,
      signal: new AbortController().signal,
      spawnAgent: vi.fn(),
      taskId,
      taskState: {},
    };
  }

  async function bash(command: string, yieldMs: number) {
    const result = await runTool(BashTool, toolOptions({ command, yieldMs }));
    return result._unsafeUnwrap();
  }

  /** Follows a process the way the agent does: a shell command, not a tool. */
  async function read(processId: string, waitMs: number) {
    return bash(`fg ${processId} --timeout ${waitMs}`, 30_000);
  }

  async function kill(processId: string) {
    return bash(`kill ${processId}`, 30_000);
  }

  it("promotes a command that outlives its yield and streams its output", async () => {
    await fs.writeFile(
      path.join(taskDirPath, "work", "tick.js"),
      'setInterval(() => console.log("tick"), 100);\n',
      "utf8",
    );

    const started = await bash("node work/tick.js", 700);

    // Still running, so it has an id and no exit code.
    expect(started.processId).toBeDefined();
    expect(started.exitCode).toBeUndefined();
    // Streamed while it ran, which is the part a doubled test cannot prove.
    expect(started.output).toContain("tick");

    const processId = started.processId ?? "";
    const readOutput = await read(processId, 400);
    expect(readOutput.output).toContain("is still running");
    // Only what arrived since the promoting call, not the whole log again.
    expect(readOutput.output).toContain("tick");

    const killed = await kill(processId);
    expect(killed.output).toContain(`Stopped ${processId}`);
  }, 30_000);

  it("captures output a killed process writes while shutting down", async () => {
    await fs.writeFile(
      path.join(taskDirPath, "work", "graceful.js"),
      [
        'process.on("SIGTERM", () => {',
        '  console.log("shutting down");',
        "  process.exit(0);",
        "});",
        'setInterval(() => console.log("beat"), 100);',
        "",
      ].join("\n"),
      "utf8",
    );

    const started = await bash("node work/graceful.js", 500);
    const processId = started.processId ?? "";

    await kill(processId);

    // The kill waits for the child to actually exit, so its shutdown output is
    // still readable rather than cut off when the log closed.
    const readOutput = await read(processId, 0);
    expect(readOutput.output).not.toContain("is still running");
    expect(readOutput.output).toContain("shutting down");
  }, 30_000);

  it.runIf(process.platform !== "win32")(
    "does not return from a kill until descendants are gone",
    async () => {
      const childPidPath = path.join(taskDirPath, "work", "child.pid");
      await fs.writeFile(
        path.join(taskDirPath, "work", "parent.js"),
        [
          'const { spawn } = require("node:child_process");',
          'const fs = require("node:fs");',
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          'fs.writeFileSync("work/child.pid", String(child.pid));',
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
        "utf8",
      );

      const started = await bash("node work/parent.js", 500);
      const processId = started.processId ?? "";
      const childPid = Number(await fs.readFile(childPidPath, "utf8"));

      try {
        const killed = await kill(processId);

        expect(killed.output).toContain(`Stopped ${processId}`);
        expect(killed.exitCode).toBe(0);
        expect(processExists(childPid)).toBe(false);
      } finally {
        if (processExists(childPid)) {
          process.kill(childPid, "SIGKILL");
          await setTimeoutPromise(20);
        }
      }
    },
    30_000,
  );

  it("returns a fast command inline without registering anything", async () => {
    const result = await bash("echo hello", 10_000);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello");
    // No id and no log file: an ordinary command leaves nothing behind.
    expect(result.processId).toBeUndefined();
    expect(result.logFilePath).toBeUndefined();
  }, 30_000);

  it("reports a builtin-only command's output only when it finishes", async () => {
    // No subprocess, so nothing streams; the interpreter reports at the end.
    const started = await bash(
      "for i in 1 2 3 4 5 6; do echo line $i; sleep 0.2; done",
      400,
    );
    const processId = started.processId ?? "";
    expect(processId).not.toBe("");
    expect(started.output).toBe("");

    const readOutput = await read(processId, 10_000);
    expect(readOutput.output).toContain("finished with exit code 0");
    expect(readOutput.output).toContain("line 6");
    // `fg` exits with the process's own code, which is what makes
    // `fg bg_1 && ...` mean what it looks like.
    expect(readOutput.exitCode).toBe(0);
  }, 30_000);

  it("redacts host paths and credentials from streamed output", async () => {
    // A shim redacts the value it returns, which is what a foreground call
    // reports. A promoted call reports the streamed copy instead, so redaction
    // has to hold on the way through the sink as well.
    await fs.writeFile(
      path.join(taskDirPath, "work", "leaky.js"),
      [
        `setTimeout(() => {`,
        `  console.log("home: " + ${JSON.stringify(os.homedir())});`,
        `  console.log("remote: https://user:tok3n@example.com/repo.git");`,
        `  console.log("password=hunter2");`,
        `}, 100);`,
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );

    const started = await bash("node work/leaky.js", 900);
    const processId = started.processId ?? "";
    expect(processId).not.toBe("");

    expect(started.output).toContain("home: ~");
    expect(started.output).not.toContain(os.homedir());
    expect(started.output).toContain("https://***@example.com");
    expect(started.output).not.toContain("tok3n");
    expect(started.output).toContain("password=***");
    expect(started.output).not.toContain("hunter2");

    // The log file on disk is the other copy the streamed bytes reach. Read it
    // after the kill, which waits for the log to close, so this sees the whole
    // file rather than however much had flushed.
    await kill(processId);
    const log = await fs.readFile(
      path.join(taskDir(taskId), started.logFilePath ?? ""),
      "utf8",
    );
    expect(log).not.toContain(os.homedir());
    expect(log).not.toContain("tok3n");
    expect(log).not.toContain("hunter2");
  }, 30_000);

  it("appends final shell output when a pipeline transforms live output", async () => {
    await fs.writeFile(
      path.join(taskDirPath, "work", "producer.js"),
      'setTimeout(() => process.stdout.write("lower\\n"), 700);\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(taskDirPath, "work", "uppercase.js"),
      "process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString().toUpperCase()));\n",
      "utf8",
    );

    const started = await bash(
      "node work/producer.js | node work/uppercase.js",
      300,
    );
    const processId = started.processId ?? "";
    const readOutput = await read(processId, 10_000);

    expect(readOutput.output).not.toContain("is still running");
    expect(readOutput.output).toContain("[final shell output]");
    expect(readOutput.output).toContain("LOWER");
  }, 30_000);
});

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
