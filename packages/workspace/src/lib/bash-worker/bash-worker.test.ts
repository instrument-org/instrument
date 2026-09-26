import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Worker } from "node:worker_threads";
import { noop } from "radashi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MOUNT } from "../../mount-points";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createTsxBashWorker } from "../../test/helpers/tsx-bash-worker";
import { type BashEnvOptions, createLocalBashEnv } from "../create-bash-env";
import { placeChatTask } from "../record-folders";
import { withShellOutputSink } from "../shell-commands/output-sink";
import { SubprocessTreeTerminationError } from "../subprocess-tree";
import { withTurnContext } from "../turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  beginSkillChangeTracking,
  consumeSkillChanges,
} from "../workspace-skill-index";
import { createRemoteBash, setBashWorkerFactory } from "./client";
import { fromWireError, type FromWorker, toWireError } from "./protocol";

// The worker compiles from source under tsx, which takes seconds the first
// time; the shared worker is warm for every test after the first.
const WORKER_TIMEOUT_MS = 60_000;

const workers: Worker[] = [];
let root: string;
let taskId: TaskId;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bash-worker-"));
  const taskPath = path.join(root, "tasks", `01k${"worker".padEnd(23, "0")}`);
  await fs.mkdir(path.join(taskPath, "work"), { recursive: true });
  taskId = createMockTaskConfigForDir(taskPath);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  setBashWorkerFactory((workerOptions) => {
    const worker = createTsxBashWorker(workerOptions);
    workers.push(worker);
    return worker;
  });
  await remoteBash().exec("true");
}, WORKER_TIMEOUT_MS);

afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.terminate()));
  await fs.rm(root, { force: true, recursive: true });
});

function currentWorker() {
  const worker = workers.at(-1);
  if (!worker) {
    throw new Error("no bash worker was started");
  }
  return worker;
}

/**
 * Whether the process is still running. A child whose worker died is never
 * reaped, so it lingers as a zombie that `kill(pid, 0)` still reports.
 */
function isAlive(pid: number) {
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
  return state !== "" && !state.startsWith("Z");
}

/** The pid of the next process tree the current worker reports starting. */
function nextTreePid() {
  return new Promise<number>((resolve) => {
    const worker = currentWorker();
    const onMessage = (message: FromWorker) => {
      if (message.type === "tree" && message.state === "started") {
        worker.off("message", onMessage);
        resolve(message.pid);
      }
    };
    worker.on("message", onMessage);
  });
}

function options(): BashEnvOptions {
  return { sessionId: StoreId.newSessionId(), taskId };
}

function remoteBash(bashOptions = options()) {
  return createRemoteBash(bashOptions, () => createLocalBashEnv(bashOptions));
}

describe("bash worker", { timeout: WORKER_TIMEOUT_MS }, () => {
  it("runs the interpreter in the worker", async () => {
    const result = await remoteBash().exec(
      "cd work && echo hi > a.txt && cat a.txt && pwd",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `hi\n${MOUNT.task}/work\n`,
    });
    expect(result.metadata?.commands).toEqual(["cd", "echo", "cat", "pwd"]);
  });

  it("runs a main-thread command the same as on the main thread", async () => {
    const bashOptions = options();
    const local = await createLocalBashEnv(bashOptions);
    const command = "cd work && jobs; echo exit=$?; pwd";
    const [remote, onMain] = await Promise.all([
      remoteBash(bashOptions).exec(command),
      local.exec(command),
    ]);
    expect(remote.stdout).toBe(onMain.stdout);
    expect(remote.exitCode).toBe(onMain.exitCode);
  });

  it("credits a skill written from the shell to the turn that wrote it", async () => {
    const bashOptions = options();
    const turn = { id: taskId, sessionId: bashOptions.sessionId };
    await beginSkillChangeTracking(turn);
    const skill = `${MOUNT.skills}/workspace/tracked`;

    await withTurnContext(turn, () =>
      remoteBash(bashOptions).exec(
        `mkdir -p ${skill} && echo body > ${skill}/SKILL.md`,
      ),
    );

    await expect(consumeSkillChanges(turn)).resolves.toMatchObject({
      created: ["tracked"],
    });
  });

  it("finds a task made inside a chat after the worker started", async () => {
    const chatId = chatFor();
    const chatTaskId = TaskIdSchema.parse(`01k${"chattask".padEnd(23, "0")}`);
    const dir = placeChatTask(chatTaskId, chatId);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "here.txt"), "inside the chat\n");

    const result = await remoteBash({
      sessionId: StoreId.newSessionId(),
      taskId: chatTaskId,
    }).exec("cat work/here.txt");
    expect(result.stdout).toBe("inside the chat\n");
  });

  it("streams native output to the sink before the result settles", async () => {
    const lines: string[] = [];
    const result = await withShellOutputSink(
      (text) => {
        lines.push(text);
      },
      () =>
        remoteBash().exec(
          `node -e 'for (let i = 0; i < 3; i++) console.log("line " + i)'`,
        ),
    );
    expect(result.exitCode).toBe(0);
    expect(lines.join("")).toBe("line 0\nline 1\nline 2\n");
  });

  it("settles a run whose sink throws, and reports the failure", async () => {
    const captureException = vi.fn();
    const config = getWorkspaceConfig();
    setWorkspaceConfig({ ...config, captureException });
    try {
      const result = await withShellOutputSink(
        () => {
          throw new Error("sink broke");
        },
        () => remoteBash().exec(`node -e 'console.log("x")'`),
      );
      expect(result.exitCode).toBe(0);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "sink broke" }),
      );
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("stops a run when its signal aborts", async () => {
    const controller = new AbortController();
    const started = performance.now();
    const run = remoteBash().exec("sleep 30", { signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 200);
    await run.catch(noop);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it("ends a dead worker's process trees and starts a fresh worker", async () => {
    await fs.writeFile(
      path.join(root, "tasks", taskId, "work", "idle.js"),
      "setInterval(() => {}, 1000);\n",
    );
    const treePid = nextTreePid();
    const run = withShellOutputSink(noop, () =>
      remoteBash().exec("node work/idle.js"),
    );
    const pid = await treePid;
    expect(isAlive(pid)).toBe(true);

    const dead = currentWorker();
    await dead.terminate();

    await expect(run).rejects.toThrow(/bash worker exited/);
    await vi.waitFor(
      () => {
        expect(isAlive(pid)).toBe(false);
      },
      { timeout: 10_000 },
    );

    const after = await remoteBash().exec("echo again");
    expect(after.stdout).toBe("again\n");
    expect(currentWorker()).not.toBe(dead);
  });
});

describe("errors across the boundary", () => {
  it("keeps the class a caller checks with instanceof, and the cause", () => {
    const revived = fromWireError(
      toWireError(
        new Error("outer", { cause: new SubprocessTreeTerminationError(42) }),
      ),
    );
    expect(revived.message).toBe("outer");
    expect(revived.cause).toBeInstanceOf(SubprocessTreeTerminationError);
    expect(revived.cause).toMatchObject({
      message: "Could not confirm that subprocess tree 42 stopped.",
      name: "SubprocessTreeTerminationError",
    });
  });
});
