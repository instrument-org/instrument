import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-state-store";

const id = TaskIdSchema.parse("task-state-store-test");

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-state-store-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function writeStateFile(state: unknown): Promise<void> {
  const privateDir = getTaskPrivateDir(taskDir(taskId));
  await fs.mkdir(privateDir, { recursive: true });
  await fs.writeFile(
    path.join(privateDir, "state.json"),
    JSON.stringify(state, null, 2),
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

  // Reading tolerates the old field; writing must not carry it back out, or
  // state.json would keep both names alive indefinitely.
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

    const written = await fs.readFile(
      path.join(getTaskPrivateDir(taskDir(taskId)), "state.json"),
      "utf8",
    );
    expect(written).toContain('"mountName": "Home-Downloads"');
    expect(written).not.toContain('"name":');
  });
});
