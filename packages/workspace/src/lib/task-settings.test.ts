import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-record";
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

  // The two views share one file, so each has to leave the other's half alone.
  it("leaves the state alone", async () => {
    await setTaskState(taskDir(taskId), { promptDraft: "half typed" });

    await updateTaskSettings(taskId, { name: "Renamed" });

    const state = await getTaskState(taskDir(taskId));
    const settings = await getTaskSettings(taskDir(taskId));

    expect(state.promptDraft).toBe("half typed");
    expect(settings?.name).toBe("Renamed");
  });

  it("survives a state half the schema cannot read", async () => {
    await updateTaskSettings(taskId, { name: "Named" });
    await fs.writeFile(
      path.join(getTaskPrivateDir(taskDir(taskId)), "settings.json"),
      JSON.stringify({ name: "Named", state: { attachedFolders: "broken" } }),
      "utf8",
    );

    const stamped = await updateTaskSettings(taskId, {
      lastActivityAt: new Date("2026-02-03T04:05:06.000Z"),
    });
    const settings = await getTaskSettings(taskDir(taskId));

    expect(stamped.isOk()).toBe(true);
    expect(settings?.name).toBe("Named");
    expect(settings?.lastActivityAt).toEqual(
      new Date("2026-02-03T04:05:06.000Z"),
    );
  });

  // The settings view is parsed as one object, so a single unreadable field
  // takes the whole view with it. Every activity stamp writes through this, so
  // a write that fills the gap with defaults erases the title of any task a
  // newer build -- or a hand edit -- left one bad field in.
  it("keeps the fields a malformed sibling makes unreadable", async () => {
    const recordPath = path.join(
      getTaskPrivateDir(taskDir(taskId)),
      "settings.json",
    );
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(
      recordPath,
      JSON.stringify({ name: "Keep this name", pinnedAt: "not-a-date" }),
      "utf8",
    );

    const stamped = await updateTaskSettings(taskId, {
      lastActivityAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    expect(stamped.isOk()).toBe(true);
    expect(JSON.parse(await fs.readFile(recordPath, "utf8"))).toEqual({
      lastActivityAt: "2026-02-03T04:05:06.000Z",
      name: "Keep this name",
      pinnedAt: "not-a-date",
    });
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
