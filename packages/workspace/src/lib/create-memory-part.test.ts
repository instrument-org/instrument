import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createMemoryPart, recordMemoryReported } from "./create-memory-part";
import {
  forgetMemory,
  listMemories,
  memoryDir,
  memoryRevision,
  saveMemory,
} from "./memory/store";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("memory-part-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-part-test-"));
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

function build() {
  return createMemoryPart({
    createdAt: new Date("2026-09-19T12:00:00.000Z"),
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId,
  });
}

describe("createMemoryPart", () => {
  it("says nothing to a fresh thread when there is nothing to remember", async () => {
    expect(await build()).toBeUndefined();
  });

  it("tells a thread what memory holds once, then only on a change", async () => {
    await saveMemory(memoryDir(), {
      from: { title: "Roofer call" },
      name: "pacific-time",
      text: "You are on Pacific time.\n\nMornings are best for calls.",
    });

    expect(await build()).toMatchObject({
      data: {
        memories: [
          {
            from: "Roofer call",
            name: "pacific-time",
            text: "You are on Pacific time.",
          },
        ],
        more: 0,
        sentAt: Date.parse("2026-09-19T12:00:00.000Z"),
      },
      type: "data-memory",
    });
    expect(await build()).toBeUndefined();

    await saveMemory(memoryDir(), { name: "address", text: "Portland." });
    expect(await build()).toMatchObject({
      data: { memories: [{ name: "address" }, { name: "pacific-time" }] },
    });
  });

  it("says memory is empty after the last one is forgotten", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();

    await forgetMemory(memoryDir(), "one");

    expect(await build()).toMatchObject({ data: { memories: [] } });
    expect(await build()).toBeUndefined();
  });

  it("stays quiet about a change the thread was told of by its own command", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await recordMemoryReported({
      revision: memoryRevision(await listMemories(memoryDir())),
      sessionId,
      taskId,
    });

    expect(await build()).toBeUndefined();
  });
});
