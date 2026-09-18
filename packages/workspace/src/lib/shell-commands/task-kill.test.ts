import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
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
import { recordTaskThread } from "../orchestrator/attribution";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runKill, runLog, type TaskCommandContext } from "./task";

const ORCHESTRATOR_ID = TaskIdSchema.parse("orchestrator");
const CHILD_ID = TaskIdSchema.parse("find-the-vault");

const context: TaskCommandContext = {
  orchestratorTaskId: ORCHESTRATOR_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;
let sessionId: StoreId.Session;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-kill-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", CHILD_ID));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", ORCHESTRATOR_ID));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
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

  it("refuses a task that is not the orchestrator's", async () => {
    leave("node work/server.js");
    await expect(
      runKill([CHILD_ID], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/no task "find-the-vault" of yours/);
  });

  // A task started in another thread reports there, so steering it from here
  // would move a conversation the user is not having; reading it stays open.
  it("refuses to act on a task another thread started, naming the thread, and still reads it", async () => {
    const theirs = StoreId.newSessionId();
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
    await recordTaskThread({
      orchestratorTaskId: ORCHESTRATOR_ID,
      sessionId: theirs,
      taskId: CHILD_ID,
    });
    const server = leave("node work/server.js");
    const here = { ...context, sessionId: StoreId.newSessionId() };
    await expect(runKill([CHILD_ID], here)).rejects.toThrow(
      `"find-the-vault" was started in another thread ("Vault hunt"), and is that thread's to steer: you can read it (\`task show\`, \`task log\`) but not send to it, stop it, or change it.`,
    );
    expect(stillRunning()).toEqual([server.id]);
    await expect(runLog([CHILD_ID], here)).resolves.toBeDefined();
    // Its own thread, and a command outside any turn, still steer it.
    await expect(
      runKill([CHILD_ID], { ...context, sessionId: theirs }),
    ).resolves.toBeDefined();
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
