import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import { addPin, getPins, removePin } from "./pins";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const taskA = TaskIdSchema.parse("task-a");
const taskB = TaskIdSchema.parse("task-b");

async function pin(id: TaskId) {
  const result = await addPin(id);
  result._unsafeUnwrap();
}

async function unpin(id: TaskId) {
  const result = await removePin(id);
  result._unsafeUnwrap();
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pins-"));
  createMockTaskConfig(taskA);
  const rootDir = WorkspaceDirSchema.parse(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
    rootDir,
    tasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
  });
  // Real task folders so the scan that derives pins can find them.
  await fs.mkdir(taskDir(taskA), { recursive: true });
  await fs.mkdir(taskDir(taskB), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("pins", () => {
  it("defaults to an empty list", async () => {
    expect(await getPins()).toEqual([]);
  });

  it("adds, dedupes, and removes pins", async () => {
    await pin(taskA);
    await pin(taskA);
    await pin(taskB);
    expect(new Set(await getPins())).toEqual(new Set([taskA, taskB]));

    await unpin(taskA);
    expect(await getPins()).toEqual([taskB]);
  });

  it("stores the pin as pinnedAt in the task settings", async () => {
    await pin(taskA);
    const pinned = await getTaskSettings(taskDir(taskA));
    expect(pinned?.pinnedAt).toBeInstanceOf(Date);

    await unpin(taskA);
    const unpinned = await getTaskSettings(taskDir(taskA));
    expect(unpinned?.pinnedAt).toBeUndefined();
  });
});
