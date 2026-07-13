import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import { taskDir } from "./task-dir-utils";
import { clearTaskIndicator, setTaskIndicator } from "./task-indicators";
import { getTaskSettings } from "./task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const taskA = TaskIdSchema.parse("task-a");

async function clear(id: TaskId) {
  const result = await clearTaskIndicator(id);
  result._unsafeUnwrap();
}

async function mark(id: TaskId, options?: { manual?: boolean }) {
  const result = await setTaskIndicator(id, "completed", options);
  result._unsafeUnwrap();
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-indicators-"));
  createMockTaskConfig(taskA);
  const rootDir = WorkspaceDirSchema.parse(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
    rootDir,
    tasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
  });
  // Real task folder so the scan that derives indicators can find it.
  await fs.mkdir(taskDir(taskA), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("task indicators", () => {
  it("defaults to no indicator in task settings", async () => {
    const settings = await getTaskSettings(taskDir(taskA));
    expect(settings?.unreadIndicator).toBeUndefined();
  });

  it("sets and clears the indicator in task settings", async () => {
    await mark(taskA);
    const set = await getTaskSettings(taskDir(taskA));
    expect(set?.unreadIndicator).toEqual({ kind: "completed" });

    await clear(taskA);
    const cleared = await getTaskSettings(taskDir(taskA));
    expect(cleared?.unreadIndicator).toBeUndefined();
  });

  it("flags a manual mark and keeps it under a later automatic mark", async () => {
    await mark(taskA, { manual: true });
    const manual = await getTaskSettings(taskDir(taskA));
    expect(manual?.unreadIndicator).toEqual({
      kind: "completed",
      manual: true,
    });

    // An agent completion mark landing after a hand mark must not downgrade it
    // to one that clears just by viewing the task.
    await mark(taskA);
    const afterAuto = await getTaskSettings(taskDir(taskA));
    expect(afterAuto?.unreadIndicator).toEqual({
      kind: "completed",
      manual: true,
    });
  });

  it("escalates a prior automatic mark when the user marks it unread", async () => {
    await mark(taskA);
    const auto = await getTaskSettings(taskDir(taskA));
    expect(auto?.unreadIndicator).toEqual({ kind: "completed" });

    await mark(taskA, { manual: true });
    const escalated = await getTaskSettings(taskDir(taskA));
    expect(escalated?.unreadIndicator).toEqual({
      kind: "completed",
      manual: true,
    });
  });
});
