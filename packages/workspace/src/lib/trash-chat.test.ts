import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatIdOf } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { initializeTask } from "./initialize-task";
import { chatTaskIdTaken, forgetRecordFolders } from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { trashChat } from "./trash-task";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

let rootDir: string;
let trashed: string[];

// The machine answers the browser teardown at once; nothing else is asked of it.
const workspaceRef = {
  send: (event: { type: string; value?: { onBrowserReaped?: () => void } }) => {
    event.value?.onBrowserReaped?.();
  },
} as never;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "trash-chat-"));
  trashed = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
    trashItem: async (item: string) => {
      trashed.push(path.relative(rootDir, item));
      await fs.rm(item, { force: true, recursive: true });
    },
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetRecordFolders();
});

afterEach(async () => {
  forgetRecordFolders();
  await fs.rm(rootDir, { force: true, recursive: true });
});

async function make(id: string, parentTaskId?: string) {
  const taskId = TaskIdSchema.parse(id);
  const made = await initializeTask(
    {
      initialSettings: {
        name: id,
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

describe("trashChat", () => {
  it("trashes the chat's folder once, with the tasks it started inside it", async () => {
    const chat = await make(chatIdOf(StoreId.newSessionId()));
    await make("2026-09-24-first-task", chat);
    await make("2026-09-24-second-task", chat);
    const other = await make("2026-09-24-not-this-chats");

    const result = await trashChat({
      id: chat,
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef,
    });

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([`chats/${chat}`]);
    expect(chatTaskIdTaken("2026-09-24-first-task")).toBe(false);
    await expect(fs.access(taskDir(other))).resolves.toBeUndefined();
  });
});
