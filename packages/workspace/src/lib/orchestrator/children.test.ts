import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatIdOf } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { type TaskKind } from "../../schemas/task-kind";
import { initializeTask } from "../initialize-task";
import { forgetRecordFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { listChildTasks } from "./children";

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "children-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetRecordFolders();
});

afterEach(async () => {
  forgetRecordFolders();
  await fs.rm(rootDir, { force: true, recursive: true });
});

async function make(id: string, parentTaskId?: string, kind?: TaskKind) {
  const taskId = TaskIdSchema.parse(id);
  const made = await initializeTask(
    {
      initialSettings: {
        name: id,
        ...(kind ? { kind } : {}),
        ...(parentTaskId
          ? { parentTaskId: TaskIdSchema.parse(parentTaskId) }
          : {}),
      },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  expect(made.isOk()).toBe(true);
  return taskId;
}

describe("listChildTasks", () => {
  it("gives a chat its own tasks, the window every chat's, and a task none", async () => {
    const window = await make("instrument", undefined, "orchestrator");
    const one = await make(
      chatIdOf(StoreId.newSessionId()),
      undefined,
      "orchestrator",
    );
    const two = await make(
      chatIdOf(StoreId.newSessionId()),
      undefined,
      "orchestrator",
    );
    const first = await make("2026-09-26-first", one);
    const second = await make("2026-09-26-second", two);

    const ids = async (id: string) =>
      (await listChildTasks(TaskIdSchema.parse(id)))
        .map((task) => task.id)
        .sort();

    expect(await ids(one)).toEqual([first]);
    expect(await ids(window)).toEqual([first, second]);
    // A task is not the window: asking it for its tasks never walks back into
    // every chat, which is a loop for anything that walks the tree.
    expect(await ids(first)).toEqual([]);
  });
});
