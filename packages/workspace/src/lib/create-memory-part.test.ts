import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  createMemoryPart,
  recordMemoryReported,
  resetMemoryReported,
} from "./create-memory-part";
import { forgetMemory, memoryDir, saveMemory } from "./memory/store";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("memory-part-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-part-test-"));
  const dir = path.join(root, TASKS_DIR_NAME, id);
  await fs.mkdir(dir, { recursive: true });
  taskId = createMockTaskConfigForDir(dir);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
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
  it("says nothing to a fresh chat when there is nothing to remember", async () => {
    expect(await build()).toBeUndefined();
  });

  it("tells a chat what memory holds once, then only on a change", async () => {
    await saveMemory(memoryDir(), {
      from: { title: "Roofer call" },
      name: "pacific-time",
      text: "You are on Pacific time.\n\nMornings are best for calls.",
    });

    expect(await build()).toMatchObject({
      data: {
        forgotten: [],
        memories: [
          {
            from: "Roofer call",
            name: "pacific-time",
            text: "You are on Pacific time.",
          },
        ],
        more: 0,
        sentAt: Date.parse("2026-09-19T12:00:00.000Z"),
        tells: "whole",
      },
      type: "data-memory",
    });
    expect(await build()).toBeUndefined();
  });

  it("tells only what was saved, corrected, or forgotten once the whole has been told", async () => {
    await saveMemory(memoryDir(), { name: "address", text: "Portland." });
    await saveMemory(memoryDir(), { name: "roofer", text: "Dale." });
    await saveMemory(memoryDir(), { name: "stevia", text: "No stevia." });
    await build();

    await saveMemory(memoryDir(), { name: "roofer", text: "Dale at Summit." });
    await saveMemory(memoryDir(), { name: "pacific-time", text: "Pacific." });
    await forgetMemory(memoryDir(), "stevia");

    // Two rows and no more: the address the chat already knows stays out.
    expect(await build()).toMatchObject({
      data: {
        forgotten: ["stevia"],
        memories: [
          { name: "pacific-time", text: "Pacific." },
          { name: "roofer", text: "Dale at Summit." },
        ],
        more: 0,
        tells: "changes",
      },
    });
    expect(await build()).toBeUndefined();
  });

  it("says memory is empty after the last one is forgotten", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();

    await forgetMemory(memoryDir(), "one");

    expect(await build()).toMatchObject({
      data: { memories: [], tells: "whole" },
    });
    expect(await build()).toBeUndefined();
  });

  it("stays quiet about a change the chat was told of by its own command", async () => {
    const { memory } = await saveMemory(memoryDir(), {
      name: "one",
      text: "One.",
    });
    await recordMemoryReported({
      memory,
      name: memory.name,
      sessionId,
      taskId,
    });

    expect(await build()).toBeUndefined();
  });

  it("still tells a change made elsewhere before the chat's own", async () => {
    await saveMemory(memoryDir(), { name: "address", text: "Portland." });
    await build();

    await saveMemory(memoryDir(), { name: "roofer", text: "Dale." });
    const { memory } = await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "Pacific.",
    });
    await recordMemoryReported({
      memory,
      name: memory.name,
      sessionId,
      taskId,
    });

    expect(await build()).toMatchObject({
      data: {
        forgotten: [],
        memories: [{ name: "roofer", text: "Dale." }],
        tells: "changes",
      },
    });
  });

  it("stays quiet about a memory the chat forgot itself", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await saveMemory(memoryDir(), { name: "two", text: "Two." });
    await build();

    await forgetMemory(memoryDir(), "one");
    await recordMemoryReported({
      memory: undefined,
      name: "one",
      sessionId,
      taskId,
    });

    expect(await build()).toBeUndefined();
  });

  it("tells the whole again once the session was reset", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();

    await resetMemoryReported({ sessionId, taskId });

    expect(await build()).toMatchObject({
      data: { memories: [{ name: "one" }], tells: "whole" },
    });
  });
});
