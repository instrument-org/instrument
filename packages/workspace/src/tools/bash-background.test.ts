import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  killSessionBackgroundProcesses,
  listChatBackgroundProcesses,
} from "../lib/background-processes";
import { chatDir } from "../lib/record-folders";
import { interruptWaits } from "../lib/wait-interrupts";
import { publisher } from "../rpc/publisher";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { runTool } from "../test/helpers/run-tool";
import { BashTool } from "./bash";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";

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
  let chatRoot: string;
  let chatId: ChatId;
  let sessionId: StoreId.Session;

  beforeEach(async () => {
    const tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-e2e-"));
    // The task id is the directory name, so it must look like one.
    chatRoot = path.join(tasksDir, `01k${"e2e".padEnd(23, "0")}`);
    await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
    chatId = createMockChatConfigForDir(chatRoot);
    sessionId = StoreId.newSessionId();
  });

  afterEach(async () => {
    await killSessionBackgroundProcesses(sessionId);
    await removeChatsDir(path.dirname(chatRoot));
  });

  function toolOptions<TInput>(input: TInput) {
    return {
      input,
      model,
      sessionId,
      signal: new AbortController().signal,
      chatId,
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
      path.join(chatRoot, "work", "tick.js"),
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

  // The whole path the header list reads: the model's own `explanation` on the
  // tool call, through promotion, onto what the task reports as running. Proved
  // here rather than at `startBackgroundRun`, because every earlier link -- the
  // tool passing its input through, the schema keeping an optional field -- is
  // exactly where it would go missing.
  it("reports a promoted process under the explanation its call gave", async () => {
    await fs.writeFile(
      path.join(chatRoot, "work", "serve.js"),
      "setInterval(() => {}, 1000);\n",
      "utf8",
    );

    const started = await runTool(
      BashTool,
      toolOptions({
        command: "node work/serve.js",
        explanation: "Starting the Node static server",
        yieldMs: 400,
      }),
    );
    const processId = started._unsafeUnwrap().processId ?? "";
    expect(processId).not.toBe("");

    const listed = listChatBackgroundProcesses(chatId).find(
      (process) => process.id === processId,
    );
    expect(listed?.explanation).toBe("Starting the Node static server");

    await kill(processId);
  }, 30_000);

  // Windows has no SIGTERM: a kill there ends the process before any handler runs.
  it.skipIf(process.platform === "win32")(
    "captures output a killed process writes while shutting down",
    async () => {
      await fs.writeFile(
        path.join(chatRoot, "work", "graceful.js"),
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
    },
    30_000,
  );

  it.runIf(process.platform !== "win32")(
    "does not return from a kill until descendants are gone",
    async () => {
      const childPidPath = path.join(chatRoot, "work", "child.pid");
      await fs.writeFile(
        path.join(chatRoot, "work", "parent.js"),
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

  it("redacts credentials from streamed output", async () => {
    // A shim redacts the value it returns, which is what a foreground call
    // reports. A promoted call reports the streamed copy instead, so redaction
    // has to hold on the way through the sink as well.
    await fs.writeFile(
      path.join(chatRoot, "work", "leaky.js"),
      [
        `setTimeout(() => {`,
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

    expect(started.output).toContain("https://***@example.com");
    expect(started.output).not.toContain("tok3n");
    expect(started.output).toContain("password=***");
    expect(started.output).not.toContain("hunter2");

    // The log file on disk is the other copy the streamed bytes reach. Read it
    // after the kill, which waits for the log to close, so this sees the whole
    // file rather than however much had flushed.
    await kill(processId);
    const log = await fs.readFile(
      path.join(chatDir(chatId), started.logFilePath ?? ""),
      "utf8",
    );
    expect(log).not.toContain("tok3n");
    expect(log).not.toContain("hunter2");
  }, 30_000);

  // A message for the session is heard at the agent's next step. It never ends
  // the command that step is running: the command moves to the background
  // and runs to its end, which wakes the session if the turn is over by then.
  it("moves a foreground command to the background when a message arrives, and lets it finish", async () => {
    const published = vi.spyOn(publisher, "publish");
    const started = performance.now();
    const running = bash("sleep 2; echo slept", 60_000);
    setTimeout(() => {
      interruptWaits(sessionId, { from: "user" });
    }, 300);
    const moved = await running;

    expect(performance.now() - started).toBeLessThan(1800);
    expect(moved.processId).toBeDefined();
    expect(moved.movedForMessageFrom).toBe("user");
    expect(moved.exitCode).toBeUndefined();
    const processId = moved.processId ?? "";
    expect(
      listChatBackgroundProcesses(chatId).find(
        (process) => process.id === processId,
      )?.status,
    ).toBe("running");

    await vi.waitFor(
      () => {
        expect(
          listChatBackgroundProcesses(chatId).find(
            (process) => process.id === processId,
          )?.status,
        ).toBe("exited");
      },
      { timeout: 10_000 },
    );
    // Ended on its own, so the session's wake hears of it.
    expect(published).toHaveBeenCalledWith("backgroundProcess.settled", {
      id: chatId,
      sessionId,
    });
    const readOutput = await read(processId, 0);
    expect(readOutput.output).toContain("finished with exit code 0");
    expect(readOutput.output).toContain("slept");
  }, 30_000);

  it("leaves a command that ends within the grace to answer for itself", async () => {
    const running = bash("sleep 0.5; echo quick", 60_000);
    setTimeout(() => {
      interruptWaits(sessionId, { from: "user" });
    }, 100);
    const result = await running;

    expect(result.processId).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("quick");
  }, 30_000);

  // Between two programs the bytes go through an OS pipe, so the live view
  // carries what the pipeline prints and never what one stage hands the next.
  it("streams what a promoted pipeline prints, not what its stages pass along", async () => {
    await fs.writeFile(
      path.join(chatRoot, "work", "producer.js"),
      'setTimeout(() => process.stdout.write("lower\\n"), 700);\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(chatRoot, "work", "uppercase.js"),
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
    expect(readOutput.output).not.toContain("[final shell output]");
    expect(readOutput.output).not.toContain("lower");
    expect(readOutput.output).toContain("LOWER");
  }, 30_000);

  it.each([
    [
      "a pipeline",
      "node work/linger.js a | node work/linger.js b | wc -l",
      ["a", "b"],
    ],
    [
      "xargs -P",
      "printf 'c\\nd\\n' | xargs -P 2 -I {} node work/linger.js {}",
      ["c", "d"],
    ],
  ])(
    "kills every program of %s promoted to the background",
    async (_, command, names) => {
      await fs.writeFile(
        path.join(chatRoot, "work", "linger.js"),
        'require("fs").writeFileSync(`work/${process.argv[2]}.pid`, String(process.pid));\nsetInterval(() => console.log("tick"), 100);\n',
        "utf8",
      );

      const started = await bash(command, 700);
      const processId = started.processId ?? "";
      expect(processId).not.toBe("");
      const pids = await Promise.all(
        names.map(async (name) => {
          const written = Number(
            await fs.readFile(
              path.join(chatRoot, "work", `${name}.pid`),
              "utf8",
            ),
          );
          return process.platform === "linux"
            ? await hostPidOf(`work/linger.js\0${name}\0`)
            : written;
        }),
      );
      expect(pids.every(processExists)).toBe(true);

      const killed = await kill(processId);
      expect(killed.output).toContain(`Stopped ${processId}`);
      // Windows can report a process for a moment after taskkill ended it.
      await expect
        .poll(() => pids.filter(processExists), { timeout: 3000 })
        .toEqual([]);
    },
    30_000,
  );
});

/**
 * The pid this computer knows a program by, found by its command line: on
 * Linux bubblewrap runs it in a pid namespace of its own, so the pid it sees
 * for itself is not one.
 */
async function hostPidOf(commandLine: string): Promise<number> {
  for (const entry of await fs.readdir("/proc")) {
    const line = await fs
      .readFile(`/proc/${entry}/cmdline`, "utf8")
      .catch(() => "");
    if (/^\d+$/.test(entry) && line.includes(commandLine)) {
      return Number(entry);
    }
  }
  return 0;
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
