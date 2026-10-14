import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Worker } from "node:worker_threads";
import { noop } from "radashi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createTsxBashWorker } from "../../test/helpers/tsx-bash-worker";
import {
  type BashEnvOptions,
  type BashRunner,
  createLocalBashEnv,
} from "../create-bash-env";
import { resolveChat, chatDir } from "../record-folders";
import { workDir } from "../work-dir";
import { withShellOutputSink } from "../shell-commands/output-sink";
import { SubprocessTreeTerminationError } from "../subprocess-tree";
import { withTurnContext } from "../turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { workspaceLayout } from "../workspace-layout";
import { getWorkspaceSkillsDir } from "../workspace-skills-dir";
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
let chatId: ChatId;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bash-worker-"));
  const chatRoot = path.join(
    workspaceLayout(root).chatsDir,
    `01k${"worker".padEnd(23, "0")}`,
  );
  // Its settings name a session, so the chat is found again on disk after a
  // test below reads the index afresh.
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.writeFile(
    path.join(chatRoot, "settings.json"),
    JSON.stringify({ chatSessionId: StoreId.newSessionId() }),
  );
  chatId = createMockChatConfigForDir(chatRoot);
  // Each chat works in a folder of its own in the machine folder, apart from
  // its records, as the app keeps them.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(workspaceLayout(root).chatsDir),
    rootDir: WorkspaceDirSchema.parse(path.join(root)),
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(root, "machine", "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
  });
  await fs.mkdir(path.join(workDir(chatId), "work"), { recursive: true });
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
 * Windows keeps no zombies, so there `kill(pid, 0)` answers.
 */
function isAlive(pid: number) {
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
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
  return { sessionId: StoreId.newSessionId(), chatId };
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
      stdout: `hi\n${shellPath(workDir(chatId))}/work\n`,
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
      `node --input-type=module -e 'console.log(JSON.stringify(await tools["my-app"].list({ page: 2 }))); try { await tools.no.way(); } catch (error) { console.log(error.message); }'`,
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
    const turn = { id: chatId, sessionId: bashOptions.sessionId };
    await beginSkillChangeTracking(turn);
    const skill = `${shellPath(getWorkspaceSkillsDir())}/tracked`;

    await withTurnContext(turn, () =>
      remoteBash(bashOptions).exec(
        `mkdir -p ${skill} && echo body > ${skill}/SKILL.md`,
      ),
    );

    await expect(consumeSkillChanges(turn)).resolves.toMatchObject({
      created: ["tracked"],
    });
  });

  it("finds a chat made after the worker started", async () => {
    const made = chatFor();
    const dir = workDir(made);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "here.txt"), "inside the chat\n");

    const result = await remoteBash({
      sessionId: StoreId.newSessionId(),
      chatId: made,
    }).exec("cat work/here.txt");
    expect(result.stdout).toBe("inside the chat\n");
  });

  it("runs in the record main resolved, without reading the index itself", async () => {
    const made = chatFor();
    const dir = workDir(made);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "here.txt"), "handed\n");
    // A scan of the disk now skips the chat, whose settings name no session;
    // only main's index, read before they went, still knows where it is.
    expect(resolveChat(made)).toBe(made);
    await fs.rm(path.join(chatDir(made), "settings.json"));

    const result = await remoteBash({
      sessionId: StoreId.newSessionId(),
      chatId: made,
    }).exec("cat work/here.txt");
    expect(result.stdout).toBe("handed\n");
  });

  // A chat's records sit in the workspace, apart from the work folder its
  // shell starts in: the agent reads what the person sent and writes its
  // handoff notes there, and meets nothing else of them. `<record>` stands for
  // the chat's record folder.
  describe("a chat's records", () => {
    let recordChat: ChatId;
    let record: string;
    let chatBash: (command: string) => ReturnType<BashRunner["exec"]>;

    beforeAll(async () => {
      recordChat = chatFor();
      record = chatDir(recordChat);
      await fs.writeFile(path.join(record, "chat.db"), "the conversation");
      await fs.mkdir(path.join(record, "attachments"), { recursive: true });
      await fs.writeFile(
        path.join(record, "attachments", "sent.json"),
        '{"sent":"by the person"}',
      );
      await fs.mkdir(path.join(workDir(recordChat), "work"), {
        recursive: true,
      });
      const bashOptions: BashEnvOptions = {
        role: "chat",
        sessionId: StoreId.newSessionId(),
        chatId: recordChat,
      };
      const bash = remoteBash(bashOptions);
      chatBash = (command) =>
        bash.exec(command.replaceAll("<record>", shellPath(record)));
    });

    it("starts in the work folder", async () => {
      const result = await chatBash("pwd");
      expect(result.stdout).toBe(`${shellPath(workDir(recordChat))}\n`);
    });

    it("reads what the person sent, and copies it into the work folder", async () => {
      const result = await chatBash(
        "cat <record>/attachments/sent.json && cp <record>/attachments/sent.json work/kept.json && cat work/kept.json",
      );
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: '{"sent":"by the person"}{"sent":"by the person"}',
      });
    });

    it.each([
      `echo '{}' > <record>/attachments/sent.json`,
      `rm -f <record>/attachments/sent.json`,
      `mv <record>/attachments/sent.json work/moved.json`,
    ])("leaves what the person sent untouched by %s", async (command) => {
      // A refused redirection rejects rather than reporting an exit code.
      await chatBash(command).catch(noop);
      await expect(
        fs.readFile(path.join(record, "attachments", "sent.json"), "utf8"),
      ).resolves.toBe('{"sent":"by the person"}');
    });

    it.each([`<record>/settings.json`, `<record>/chat.db`])(
      "refuses to read %s",
      async (target) => {
        const result = await chatBash(`cat ${target}`);
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).toBe("");
      },
    );

    it("writes its handoff notes beside the records", async () => {
      const result = await chatBash(
        "echo 'the goal, and what is left' > <record>/handoff-notes.md && cat <record>/handoff-notes.md",
      );
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "the goal, and what is left\n",
      });
      await expect(
        fs.readFile(path.join(record, "handoff-notes.md"), "utf8"),
      ).resolves.toBe("the goal, and what is left\n");
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
      path.join(workDir(chatId), "work", "idle.js"),
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
