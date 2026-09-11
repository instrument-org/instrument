import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { initializeTask } from "../initialize-task";
import { cancelAskedWake } from "../orchestrator/wake";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runWake, type TaskCommandContext } from "./task";

const ORCHESTRATOR_ID = TaskIdSchema.parse("orchestrator");
const CHILD_ID = TaskIdSchema.parse("audit-the-runtime");

const working = vi.hoisted(() => ({ value: true }));

vi.mock(import("../orchestrator/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: () => working.value,
}));

// The timer needs the actor only when it fires, which these tests never let
// happen; what the command hands it is not read before then.
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () => ({}) as never,
  setWorkspaceActorRef: vi.fn(),
}));

const context: TaskCommandContext = {
  orchestratorTaskId: ORCHESTRATOR_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;

beforeEach(async () => {
  working.value = true;
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-wake-"));
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
        name: "Audit the runtime",
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
});

afterEach(async () => {
  cancelAskedWake(CHILD_ID);
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("task wake", () => {
  it("schedules a wake about a working task and lets it be moved or forgotten", async () => {
    const asked = await runWake([CHILD_ID, "--in", "5m"], context);
    expect(asked.stdout).toBe(
      `You will be woken about ${CHILD_ID} in 5 minutes if it is still working; sooner if it finishes. End your turn.\n`,
    );

    const moved = await runWake([CHILD_ID, "--in", "30s"], context);
    expect(moved.stdout).toContain("in 30 seconds");

    const forgotten = await runWake([CHILD_ID, "--cancel"], context);
    expect(forgotten.stdout).toBe(
      `Forgot the wake you asked for about ${CHILD_ID}; the clock takes over again.\n`,
    );
    const again = await runWake([CHILD_ID, "--cancel"], context);
    expect(again.stdout).toBe(`No wake was pending for ${CHILD_ID}.\n`);
  });

  it("has nothing to schedule for a task that is not running", async () => {
    working.value = false;
    const result = await runWake([CHILD_ID, "--in", "5m"], context);
    expect(result.stdout).toContain("is not running");
    expect(cancelAskedWake(CHILD_ID)).toBe(false);
  });

  it.each([
    { args: [CHILD_ID], message: "--in takes a delay" },
    { args: [CHILD_ID, "--in", "soon"], message: "--in takes a delay" },
    { args: [CHILD_ID, "--in", "3h"], message: "at most 2 hours" },
  ])("refuses $args", async ({ args, message }) => {
    await expect(runWake(args, context)).rejects.toThrow(message);
  });

  it("refuses a task that is not the orchestrator's", async () => {
    await expect(
      runWake([CHILD_ID, "--in", "5m"], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/no task "audit-the-runtime" of yours/);
  });
});
