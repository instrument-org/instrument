import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createPaneTabsPart } from "./create-pane-tabs-part";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-state-store";

const id = TaskIdSchema.parse("pane-tabs-part-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pane-tabs-part-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

function build() {
  return createPaneTabsPart({
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId,
  });
}

async function openTabs(...filePaths: string[]) {
  await setTaskState(taskDir(taskId), {
    pane: TaskPane.openTabs(TaskPane.EMPTY, filePaths.map(TaskPane.fileTab)),
  });
}

describe("createPaneTabsPart", () => {
  it("names what is open the first time it is asked", async () => {
    await openTabs("output/report.pdf");

    expect(await build()).toMatchObject({
      data: { tabs: [{ filePath: "output/report.pdf", type: "file" }] },
      type: "data-paneTabs",
    });
  });

  it("says nothing when the same tabs are still open", async () => {
    await openTabs("output/report.pdf");
    await build();

    expect(await build()).toBeUndefined();
  });

  // The list exists to stop the agent reopening what is already on screen, and
  // dragging a tab changes nothing about that.
  it("ignores a change of order", async () => {
    await openTabs("a.png", "b.png");
    await build();

    await setTaskState(taskDir(taskId), {
      pane: TaskPane.reorderTabs(
        TaskPane.openTabs(TaskPane.EMPTY, [
          TaskPane.fileTab("a.png"),
          TaskPane.fileTab("b.png"),
        ]),
        ["file:b.png", "file:a.png"],
      ),
    });

    expect(await build()).toBeUndefined();
  });

  it("speaks up when a tab is added", async () => {
    await openTabs("a.png");
    await build();
    await openTabs("a.png", "b.png");

    expect(await build()).toMatchObject({ type: "data-paneTabs" });
  });

  it("stays quiet about a pane that has never held anything", async () => {
    expect(await build()).toBeUndefined();
  });

  // Closing everything is not worth a line of its own, but the agent was told
  // the file was open, so the next thing opened has to be reported again.
  it("reports again after the pane is emptied", async () => {
    await openTabs("a.png");
    await build();

    await setTaskState(taskDir(taskId), { pane: TaskPane.EMPTY });
    expect(await build()).toBeUndefined();

    await openTabs("a.png");
    expect(await build()).toMatchObject({ type: "data-paneTabs" });
  });
});
