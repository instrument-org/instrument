import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Worker } from "node:worker_threads";
import { noop } from "radashi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MOUNT } from "../../mount-points";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createTsxBashWorker } from "../../test/helpers/tsx-bash-worker";
import {
  type BashEnvOptions,
  type BashRunner,
  createLocalBashEnv,
} from "../create-bash-env";
import { placeTask } from "../record-folders";
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
import { type ChatId } from "../../schemas/chat-id";
import { taskDir } from "../task-dir-utils";

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

/** Answers a script's `tools.*` with what it was called with, or refuses `tools.no.*`. */
function echoTool(toolPath: string, argsJson: string) {
  return toolPath.startsWith("no.")
    ? Promise.reject(new Error(`refused ${toolPath}`))
    : Promise.resolve(
        JSON.stringify({ args: JSON.parse(argsJson), path: toolPath }),
      );
}

function remoteBash(bashOptions = options()) {
  return createRemoteBash(
    bashOptions,
    () => createLocalBashEnv(bashOptions),
    echoTool,
  );
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

  it("makes a script's tool calls on the main thread", async () => {
    const result = await remoteBash().exec(
      `js-exec -c 'console.log(JSON.stringify(await tools["my-app"].list({ page: 2 }))); try { await tools.no.way(); } catch (error) { console.log(error.message); }'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "{"args":{"page":2},"path":"my-app.list"}
      refused no.way
      "
    `);
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
    const dir = placeTask(chatTaskId, chatId);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "here.txt"), "inside the chat\n");

    const result = await remoteBash({
      sessionId: StoreId.newSessionId(),
      taskId: chatTaskId,
    }).exec("cat work/here.txt");
    expect(result.stdout).toBe("inside the chat\n");
  });

  it("runs in the record main resolved, without reading the index itself", async () => {
    const chatId = chatFor();
    const chatTaskId = TaskIdSchema.parse(`01k${"handedtask".padEnd(23, "0")}`);
    const dir = placeTask(chatTaskId, chatId);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "here.txt"), "handed\n");
    // A scan of the disk now skips the chat, whose settings name no session;
    // only main's index still knows where the task is.
    await fs.rm(path.join(taskDir(chatId), ".instrument", "settings.json"));

    const result = await remoteBash({
      sessionId: StoreId.newSessionId(),
      taskId: chatTaskId,
    }).exec("cat work/here.txt");
    expect(result.stdout).toBe("handed\n");
  });

  // A chat's tasks sit inside the chat's own folder, which mounts writable at
  // /task. The chat reaches them at /tasks/<id>, read-only with their private
  // dirs masked, and must not get around that through /task/tasks/<id>.
  describe("a chat's tasks", () => {
    const childId = TaskIdSchema.parse(`01k${"nestedchild".padEnd(23, "0")}`);
    let chatId: ChatId;
    let childDir: string;
    let chatDir: string;
    let chatBash: (command: string) => ReturnType<BashRunner["exec"]>;

    const childSettings = () =>
      fs.readFile(path.join(childDir, ".instrument", "settings.json"), "utf8");

    beforeAll(async () => {
      chatId = chatFor();
      childDir = placeTask(childId, chatId);
      chatDir = path.dirname(path.dirname(childDir));
      await fs.mkdir(path.join(childDir, ".instrument"), { recursive: true });
      await fs.writeFile(
        path.join(childDir, ".instrument", "settings.json"),
        '{"private":"sentinel"}',
      );
      await fs.mkdir(path.join(childDir, "output"), { recursive: true });
      await fs.writeFile(path.join(childDir, "output", "report.md"), "made\n");
      await fs.mkdir(path.join(chatDir, "attachments"), { recursive: true });
      await fs.mkdir(path.join(chatDir, "work"), { recursive: true });
      await fs.writeFile(
        path.join(chatDir, "attachments", "replacement.json"),
        '{"private":"overwritten"}',
      );
      const bashOptions: BashEnvOptions = {
        chat: {
          // The mount `childTaskMounts` gives the chat for this task.
          childMounts: [
            {
              hostRoot: AbsolutePathSchema.parse(childDir),
              maskedEntries: [".instrument"],
              mountPoint: `${MOUNT.tasks}/${childId}`,
              readOnly: true,
            },
          ],
          id: chatId,
        },
        sessionId: StoreId.newSessionId(),
        taskId: chatId,
      };
      const bash = remoteBash(bashOptions);
      chatBash = (command) => bash.exec(command);
    });

    it("reads a task through its read-only mount", async () => {
      const result = await chatBash(
        `cat ${MOUNT.tasks}/${childId}/output/report.md`,
      );
      expect(result).toMatchObject({ exitCode: 0, stdout: "made\n" });
      const privateRead = await chatBash(
        `cat ${MOUNT.tasks}/${childId}/.instrument/settings.json`,
      );
      expect(privateRead.exitCode).not.toBe(0);
    });

    it.each([
      `${MOUNT.task}/tasks/${childId}/.instrument/settings.json`,
      `tasks/${childId}/.instrument/settings.json`,
      `${MOUNT.task}/TASKS/${childId}/.instrument/settings.json`,
      `${MOUNT.task}/tasks/${childId}/output/report.md`,
    ])("refuses to read %s", async (target) => {
      const result = await chatBash(`cat ${target}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it.each([
      `cp ${MOUNT.task}/attachments/replacement.json ${MOUNT.task}/tasks/${childId}/.instrument/settings.json`,
      `cp attachments/replacement.json tasks/${childId}/.instrument/settings.json`,
      `cp -r ${MOUNT.task}/attachments ${MOUNT.task}/tasks/${childId}/.instrument`,
      `mv ${MOUNT.task}/attachments/replacement.json ${MOUNT.task}/tasks/${childId}/.instrument/settings.json`,
      `echo '{}' > ${MOUNT.task}/tasks/${childId}/.instrument/settings.json`,
      `rm -rf ${MOUNT.task}/tasks`,
      `rm -f ${MOUNT.task}/tasks/${childId}/output/report.md`,
      `mkdir -p ${MOUNT.task}/tasks/${childId}/output/more`,
      `ln -s ${MOUNT.task}/tasks/${childId} ${MOUNT.task}/work/child && cp ${MOUNT.task}/attachments/replacement.json ${MOUNT.task}/work/child/.instrument/settings.json`,
    ])("leaves the task untouched by %s", async (command) => {
      // A refused redirection rejects rather than reporting an exit code.
      await chatBash(command).catch(noop);
      await expect(childSettings()).resolves.toBe('{"private":"sentinel"}');
      await expect(
        fs.readFile(path.join(childDir, "output", "report.md"), "utf8"),
      ).resolves.toBe("made\n");
      await expect(
        fs.stat(path.join(childDir, "output", "more")),
      ).rejects.toThrow();
      await expect(
        fs.stat(path.join(chatDir, "attachments", "replacement.json")),
      ).resolves.toBeDefined();
    });

    // Each of these also reaches the chat's own attachment, so a command that
    // failed outright cannot pass for one that left the tasks dir alone.
    it.each([
      `ls -aR ${MOUNT.task}`,
      `find ${MOUNT.task}`,
      `grep -r private ${MOUNT.task}`,
      `rg -uu private ${MOUNT.task}`,
      `rg -uu --files`,
      `cd ${MOUNT.task}/work && rg -uu private ${MOUNT.task}`,
      `cd ${MOUNT.task}/work && rg -uu private ..`,
      `du -a ${MOUNT.task}`,
    ])("keeps %s out of the tasks dir", async (command) => {
      const result = await chatBash(command);
      expect(result.stdout).toMatch(/replacement\.json|overwritten/);
      expect(result.stdout).not.toMatch(/sentinel|report\.md|\btasks\b/);
    });

    it.each([
      `rg -uu private tasks`,
      `rg -uu private tasks/${childId}`,
      `rg -uu private ${MOUNT.task}/tasks/${childId}/.instrument`,
    ])("finds nothing with %s", async (command) => {
      const result = await chatBash(command);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("copies nothing out of the tasks dir", async () => {
      const result = await chatBash(
        `cp -r ${MOUNT.task}/tasks ${MOUNT.task}/work/copy`,
      );
      expect(result.exitCode).not.toBe(0);
      await expect(
        fs.stat(path.join(chatDir, "work", "copy")),
      ).rejects.toThrow();
    });

    it("leaves the chat's own files writable", async () => {
      const result = await chatBash(
        `cp attachments/replacement.json work/kept.json && mkdir -p work/tasks && echo note > work/tasks/todo.md && cat work/kept.json work/tasks/todo.md`,
      );
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: '{"private":"overwritten"}note\n',
      });
    });
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
