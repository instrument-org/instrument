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
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runKill, type TaskCommandContext } from "./task";

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
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
  });
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
});
