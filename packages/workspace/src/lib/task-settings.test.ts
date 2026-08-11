import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";

const id = TaskIdSchema.parse("task-settings-test");

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-settings-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("updateTaskSettings", () => {
  it("keeps both fields when two updates overlap", async () => {
    await updateTaskSettings(taskId, { name: "Untitled task" });

    // The real pair: a generated title landing while a sent message records
    // activity. Read-modify-write without a queue loses whichever wrote first.
    const activityAt = new Date("2026-02-03T04:05:06.000Z");
    await Promise.all([
      updateTaskSettings(taskId, { name: "Generated title" }),
      updateTaskSettings(taskId, { lastActivityAt: activityAt }),
    ]);

    const settings = await getTaskSettings(taskDir(taskId));

    expect(settings?.name).toBe("Generated title");
    expect(settings?.lastActivityAt).toEqual(activityAt);
  });

  it("applies overlapping updates to the same field in call order", async () => {
    const [first, second] = await Promise.all([
      updateTaskSettings(taskId, { name: "First" }),
      updateTaskSettings(taskId, { name: "Second" }),
    ]);

    const settings = await getTaskSettings(taskDir(taskId));

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(settings?.name).toBe("Second");
  });

  it("clears a pin with null while a concurrent update keeps its own field", async () => {
    await updateTaskSettings(taskId, {
      name: "Pinned",
      pinnedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const results = await Promise.all([
      updateTaskSettings(taskId, { pinnedAt: null }),
      updateTaskSettings(taskId, { unreadIndicator: { kind: "completed" } }),
    ]);

    const settings = await getTaskSettings(taskDir(taskId));

    expect(results.every((result) => result.isOk())).toBe(true);
    expect(settings?.pinnedAt).toBeUndefined();
    expect(settings?.unreadIndicator).toEqual({ kind: "completed" });
  });
});
