import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatIdOf, sessionOfChat } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import {
  killSessionBackgroundProcesses,
  listTaskBackgroundProcesses,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../background-processes";
import { initializeTask } from "../initialize-task";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runKill, runLog, type TaskCommandContext } from "./task";

// The chat the tasks were started in, a fresh one per test: a store handle is
// kept per record id, and each test's workspace is a folder of its own.
let ORCHESTRATOR_ID = chatIdOf(StoreId.newSessionId());
const CHILD_ID = TaskIdSchema.parse("find-the-vault");

let context: TaskCommandContext;

let rootDir: string;
let sessionId: StoreId.Session;

beforeEach(async () => {
  ORCHESTRATOR_ID = chatIdOf(StoreId.newSessionId());
  context = { orchestratorTaskId: ORCHESTRATOR_ID, remainingYieldMs: () => 0 };
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-kill-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", CHILD_ID));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", ORCHESTRATOR_ID));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // A chat's record goes under the root, kept apart from the folders
    // the test attaches.
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  const orchestrator = await initializeTask(
    {
      initialSettings: { kind: "orchestrator", name: "Instrument" },
      taskId: ORCHESTRATOR_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (orchestrator.isErr()) {
    throw orchestrator.error;
  }
  const created = await initializeTask(
    {
      initialSettings: {
        name: "Find the vault",
        parentTaskId: ORCHESTRATOR_ID,
      },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await killSessionBackgroundProcesses(sessionId);
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A process the child left behind: a run that streams nothing and ends only
 * when its signal aborts, the way a killed subprocess settles.
 */
function leave(command: string) {
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command,
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
    taskId: CHILD_ID,
  });
  const promoted = promoteBackgroundProcess({
    handle,
    sessionId,
    taskId: CHILD_ID,
  });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return promoted.info;
}

function stillRunning() {
  return listTaskBackgroundProcesses(CHILD_ID)
    .filter((process) => process.status === "running")
    .map((process) => process.id);
}

describe("task kill", () => {
  it("stops the one process named and leaves the rest", async () => {
    const scan = leave("rg -l vault /mnt/Home | head -200");
    const server = leave("node work/server.js");

    const result = await runKill([CHILD_ID, scan.id], context);

    expect(result.stdout).toBe(
      `Stopped ${scan.id} \`rg -l vault /mnt/Home | head -200\` (1 second).\n`,
    );
    expect(stillRunning()).toEqual([server.id]);
  });

  it("stops everything when no process is named", async () => {
    const scan = leave("rg -l vault /mnt/Home | head -200");
    const server = leave("node work/server.js");

    const result = await runKill([CHILD_ID], context);

    expect(result.stdout).toContain(`Stopped ${scan.id}`);
    expect(result.stdout).toContain(`Stopped ${server.id}`);
    expect(stillRunning()).toEqual([]);
  });

  it("says so when nothing is running", async () => {
    const result = await runKill([CHILD_ID], context);
    expect(result.stdout).toBe(
      `${CHILD_ID} has nothing running in the background.\n`,
    );
  });

  it("names what is running when the id is not there", async () => {
    const server = leave("node work/server.js");
    await expect(runKill([CHILD_ID, "bg_99"], context)).rejects.toThrow(
      `no bg_99 running in ${CHILD_ID}. In the background: ${server.id} \`node work/server.js\` (1 second).`,
    );
    expect(stillRunning()).toEqual([server.id]);
  });

  it("refuses a task another chat started", async () => {
    leave("node work/server.js");
    await expect(
      runKill([CHILD_ID], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/"find-the-vault" was started in another thread/);
  });

  // A task started in another thread reports there, so steering it from here
  // would move a conversation the user is not having; reading it stays open.
  it("refuses to act on a task another chat started, naming the chat, and still reads it", async () => {
    const theirs = sessionOfChat(ORCHESTRATOR_ID);
    if (!theirs) {
      throw new Error("not a chat");
    }
    const saved = await Store.saveSession(
      {
        createdAt: new Date(),
        id: theirs,
        title: "Vault hunt",
      },
      ORCHESTRATOR_ID,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
    const server = leave("node work/server.js");
    const elsewhere = chatIdOf(StoreId.newSessionId());
    const here = { ...context, orchestratorTaskId: elsewhere };
    await expect(runKill([CHILD_ID], here)).rejects.toThrow(
      `"find-the-vault" was started in another thread ("Vault hunt"), and is that thread's to steer: you can read it (\`task show\`, \`task log\`) but not send to it, stop it, or change it.`,
    );
    expect(stillRunning()).toEqual([server.id]);
    await expect(runLog([CHILD_ID], here)).resolves.toBeDefined();
    // Its own chat still steers it.
    await expect(runKill([CHILD_ID], context)).resolves.toBeDefined();
  });

  // An id guessed from a task's title gets most of the words right, and the
  // miss cost a turn and two more minutes of the process it meant to stop.
  it("offers the nearest of its own tasks for a mistyped id", async () => {
    await expect(runKill(["find-the-vaults"], context)).rejects.toThrow(
      'no task "find-the-vaults" of yours. Did you mean "find-the-vault"? See `task list`.',
    );
    await expect(runKill(["draft-a-brief"], context)).rejects.toThrow(
      'no task "draft-a-brief" of yours. See `task list`.',
    );
  });
});
