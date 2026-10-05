import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { recordChanged, recordChanges, recordRemoved } from "./record-changes";
import { setTaskState } from "./task-record";
import { taskDir } from "./task-dir-utils";
import { updateTaskSettings } from "./task-settings";

const one = TaskIdSchema.parse("record-changes-one");
const two = TaskIdSchema.parse("record-changes-two");

describe("recordChanges", () => {
  it("hands over a burst as one batch, each change once", async () => {
    const changes = recordChanges(undefined);
    recordChanged(one, "messages");
    recordChanged(one, "messages");
    recordChanged(two, "agent");
    recordChanged(one, "session");
    const batch = await changes.next();
    expect(batch.value).toEqual([
      { id: one, kind: "messages" },
      { id: two, kind: "agent" },
      { id: one, kind: "session" },
    ]);
    await changes.return();
  });

  it("keeps what lands while the consumer is away for its next pull", async () => {
    const changes = recordChanges(undefined);
    recordChanged(one, "messages");
    await changes.next();
    recordChanged(two, "settings");
    expect((await changes.next()).value).toEqual([
      { id: two, kind: "settings" },
    ]);
    await changes.return();
  });

  it("carries what a removed record was, and hands over only what it is asked to keep", async () => {
    const changes = recordChanges(undefined, (change) => change.id === two);
    recordChanged(one, "messages");
    recordRemoved({ chatId: undefined, id: two, kind: "task" });
    expect((await changes.next()).value).toEqual([
      {
        id: two,
        kind: "removed",
        ref: { chatId: undefined, id: two, kind: "task" },
      },
    ]);
    await changes.return();
  });

  it("ends when its signal aborts", async () => {
    const controller = new AbortController();
    const changes = recordChanges(controller.signal);
    const next = changes.next();
    controller.abort();
    expect(await next).toEqual({ done: true, value: undefined });
  });
});

describe("the record writer on the feed", () => {
  it("says a settings write moved the settings and a state write the state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "record-changes-"));
    const taskId = createMockTaskConfigForDir(
      path.join(root, TASKS_DIR_NAME, "record-changes-task"),
    );
    await fs.mkdir(taskDir(taskId), { recursive: true });
    const changes = recordChanges(undefined, (change) => change.id === taskId);

    expect((await updateTaskSettings(taskId, { name: "Named" })).isOk()).toBe(
      true,
    );
    expect((await changes.next()).value).toEqual([
      { id: taskId, kind: "settings" },
    ]);
    await setTaskState(taskDir(taskId), { selectedModelURI: undefined });
    expect((await changes.next()).value).toEqual([
      { id: taskId, kind: "state" },
    ]);

    await changes.return();
    await fs.rm(root, { force: true, recursive: true });
  });
});
