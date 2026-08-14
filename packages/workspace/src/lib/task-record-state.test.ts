import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState, updateTaskPane } from "./task-record";
import { getTaskSettings, updateTaskSettings } from "./task-settings";

const id = TaskIdSchema.parse("task-record-state-test");

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-record-state-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function recordFilePath(): string {
  return path.join(getTaskPrivateDir(taskDir(taskId)), "settings.json");
}

async function writeStateFile(state: unknown): Promise<void> {
  const privateDir = getTaskPrivateDir(taskDir(taskId));
  await fs.mkdir(privateDir, { recursive: true });
  await fs.writeFile(
    recordFilePath(),
    JSON.stringify({ name: "Test task", state }, null, 2),
    "utf8",
  );
}

describe("getTaskState", () => {
  // A task attached before the rename has `name` on disk. This read swallows
  // every parse failure and answers with empty state, so getting it wrong would
  // not raise anything: the folders would simply stop being mounted, in a task
  // whose sidebar still lists them.
  it("keeps the folders of a task written before the rename", async () => {
    await writeStateFile({
      attachedFolders: {
        "Home-Downloads": {
          access: "read-write",
          createdAt: 1_718_198_400_000,
          id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
          name: "Home-Downloads",
          path: "/Users/sam/Downloads",
          source: "user",
        },
      },
      selectedModelURI: "instrument/auto",
    });

    const state = await getTaskState(taskDir(taskId));

    expect(state.attachedFolders?.["Home-Downloads"]).toMatchObject({
      access: "read-write",
      mountName: "Home-Downloads",
      path: "/Users/sam/Downloads",
    });
  });

  it("reads back what it writes", async () => {
    await setTaskState(taskDir(taskId), {
      attachedFolders: {
        Downloads: {
          access: "read-only",
          createdAt: 1_718_198_400_000,
          id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN" as never,
          mountName: "Downloads",
          path: "/Users/sam/Downloads" as never,
          source: "user",
        },
      },
    });

    const state = await getTaskState(taskDir(taskId));

    expect(state.attachedFolders?.Downloads?.mountName).toBe("Downloads");
  });

  // Reading tolerates the old field; writing must not carry it back out, or the
  // record would keep both names alive indefinitely.
  it("writes only the current field name back to disk", async () => {
    await writeStateFile({
      attachedFolders: {
        "Home-Downloads": {
          access: "read-write",
          createdAt: 1_718_198_400_000,
          id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
          name: "Home-Downloads",
          path: "/Users/sam/Downloads",
          source: "user",
        },
      },
    });

    await setTaskState(taskDir(taskId), { promptDraft: "anything" });

    const written = await fs.readFile(recordFilePath(), "utf8");
    expect(written).toContain('"mountName": "Home-Downloads"');
    expect(written).not.toContain('"name": "Home-Downloads"');
  });
});

describe("the pane", () => {
  it("round-trips through the stored schema", async () => {
    await setTaskState(taskDir(taskId), {
      pane: {
        open: true,
        selected: "file:output/report.pdf",
        tabs: [{ filePath: "output/report.pdf", type: "file" }],
      },
    });

    const state = await getTaskState(taskDir(taskId));

    expect(state.pane).toMatchInlineSnapshot(`
      {
        "open": true,
        "selected": "file:output/report.pdf",
        "tabs": [
          {
            "filePath": "output/report.pdf",
            "type": "file",
          },
        ],
      }
    `);
  });

  it("serializes overlapping writes instead of losing one", async () => {
    await Promise.all([
      updateTaskPane(taskDir(taskId), (pane) =>
        TaskPane.openTabs(pane, [TaskPane.fileTab("a.png")]),
      ),
      updateTaskPane(taskDir(taskId), (pane) =>
        TaskPane.openTabs(pane, [TaskPane.fileTab("b.png")]),
      ),
    ]);

    const state = await getTaskState(taskDir(taskId));

    expect(state.pane?.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:a.png",
      "file:b.png",
    ]);
  });

  /**
   * The reason the client sends an operation rather than a pane.
   *
   * A user clicking a file reference reads the pane it can see, and the agent's
   * `show` can land between that read and the resulting write. Replaying the
   * intent against current state keeps both; writing the computed snapshot
   * would silently drop whichever landed in between.
   */
  it("keeps a tab the agent opened while the user was clicking", async () => {
    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.openTabs(pane, [TaskPane.fileTab("already-open.png")]),
    );

    // What the client can see at the moment of the click.
    const atClickTime = await getTaskState(taskDir(taskId));
    const seenByClient = atClickTime.pane;
    expect(seenByClient?.tabs).toHaveLength(1);

    // The agent shows something while that click is in flight.
    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.openTabs(pane, [TaskPane.fileTab("agent-opened.png")]),
    );

    // The click arrives, carrying what the user did rather than what they saw.
    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.applyOperation(pane, {
        filePaths: ["user-clicked.png"],
        type: "openFiles",
      }),
    );

    const state = await getTaskState(taskDir(taskId));
    expect(state.pane?.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:already-open.png",
      "file:agent-opened.png",
      "file:user-clicked.png",
    ]);

    // And had it sent the pane it saw, this is what would have been lost.
    const fromSnapshot = TaskPane.openTabs(seenByClient ?? TaskPane.EMPTY, [
      TaskPane.fileTab("user-clicked.png"),
    ]);
    expect(fromSnapshot.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:already-open.png",
      "file:user-clicked.png",
    ]);
  });

  /**
   * The pane and the task's settings are the same file now, so the two write
   * paths have to share one queue. The pair that actually happens: a title
   * generated after the first message lands while the user is opening a tab.
   * Without a shared queue each merges onto the record the other has not
   * written, and whichever lands second erases the other's half.
   */
  it("does not lose a generated title to a tab opening at the same time", async () => {
    await updateTaskSettings(taskId, { name: "Untitled task" });

    await Promise.all([
      updateTaskSettings(taskId, { name: "Generated title" }),
      updateTaskPane(taskDir(taskId), (pane) =>
        TaskPane.applyOperation(pane, {
          filePaths: ["output/report.pdf"],
          type: "openFiles",
        }),
      ),
    ]);

    const settings = await getTaskSettings(taskDir(taskId));
    const state = await getTaskState(taskDir(taskId));

    expect(settings?.name).toBe("Generated title");
    expect(state.pane?.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:output/report.pdf",
    ]);
  });
});
