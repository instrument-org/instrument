import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import { addPin, getPins, removePin } from "./pins";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { disposeWorkspaceStoreStorage } from "./workspace-store-storage";

const taskA = TaskIdSchema.parse("task-a");
const taskB = TaskIdSchema.parse("task-b");

let root: string;

async function pins() {
  const result = await getPins();
  return result._unsafeUnwrap();
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-store-"));
  createMockTaskConfig(taskA);
  const rootDir = WorkspaceDirSchema.parse(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
    rootDir,
  });
});

afterEach(async () => {
  await disposeWorkspaceStoreStorage();
  await fs.rm(root, { force: true, recursive: true });
});

describe("pins", () => {
  it("defaults to an empty list", async () => {
    expect(await pins()).toEqual([]);
  });

  it("adds, dedupes, and removes pins", async () => {
    await addPin(taskA);
    await addPin(taskA);
    await addPin(taskB);
    expect(await pins()).toEqual([taskA, taskB]);

    await removePin(taskA);
    expect(await pins()).toEqual([taskB]);
  });

  it("persists across a fresh store instance", async () => {
    await addPin(taskB);
    await disposeWorkspaceStoreStorage();
    expect(await pins()).toEqual([taskB]);
  });
});
