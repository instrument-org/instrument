import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { attachFolder, detachFolder } from "./attach-folder";
import { detectAttachedFolderChanges } from "./attached-folder-changes";
import { setAttachedFoldersBaseline } from "./attached-folders-baseline";
import { initializeTask } from "./initialize-task";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

// A task of its own per test: the session store is cached by task id, so a
// second task under one name in a fresh temp directory reuses the handle on the
// database the last one deleted, which answers every write as readonly.
let taskCount = 0;
let TASK_ID: ReturnType<typeof TaskIdSchema.parse>;

let rootDir: string;
let sessionId: StoreId.Session;
let downloads: string;

async function changesSince(
  baseline: {
    access: "read-only" | "read-write";
    name: string;
    path: string;
  }[],
  announced?: string[],
) {
  const set = await setAttachedFoldersBaseline(TASK_ID, sessionId, baseline);
  if (set.isErr()) {
    throw set.error;
  }
  const result = await detectAttachedFolderChanges({
    ...(announced ? { announced } : {}),
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId: TASK_ID,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value?.type === "data-attachedFolderChanges"
    ? result.value.data
    : undefined;
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "folder-changes-"));
  downloads = path.join(rootDir, "Downloads");
  await fs.mkdir(downloads, { recursive: true });
  TASK_ID = TaskIdSchema.parse(`find-the-vault-${++taskCount}`);
  createMockTaskConfigForDir(path.join(rootDir, "tasks", TASK_ID));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
  });
  const created = await initializeTask(
    {
      initialSettings: { name: "Find the vault" },
      taskId: TASK_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("detectAttachedFolderChanges", () => {
  it("reports a folder handed to the task between turns", async () => {
    await attachFolder({
      access: "read-write",
      path: downloads,
      taskId: TASK_ID,
    });

    const changes = await changesSince([]);

    expect(changes?.added).toEqual([
      { access: "read-write", name: "Downloads", path: downloads },
    ]);
  });

  it("says nothing about a folder arriving with this same message", async () => {
    await attachFolder({
      access: "read-write",
      path: downloads,
      taskId: TASK_ID,
    });

    // What the attachment part on the message already lists in full.
    const changes = await changesSince([], [downloads]);

    expect(changes).toBeUndefined();
  });

  it("still reports a removal on a message that brings a folder of its own", async () => {
    const gone = path.join(rootDir, "Old");
    await fs.mkdir(gone);
    await attachFolder({ access: "read-only", path: gone, taskId: TASK_ID });
    await attachFolder({
      access: "read-write",
      path: downloads,
      taskId: TASK_ID,
    });
    await detachFolder({ path: gone, taskId: TASK_ID });

    const changes = await changesSince(
      [{ access: "read-only", name: "Old", path: gone }],
      [downloads],
    );

    expect(changes?.added).toEqual([]);
    expect(changes?.removed).toEqual([
      { access: "read-only", name: "Old", path: gone },
    ]);
  });

  it("reports nothing when the folders are as the model last saw them", async () => {
    await attachFolder({
      access: "read-write",
      path: downloads,
      taskId: TASK_ID,
    });

    const changes = await changesSince([
      { access: "read-write", name: "Downloads", path: downloads },
    ]);

    expect(changes).toBeUndefined();
  });
});
