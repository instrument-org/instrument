import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getBrowserState, recordBrowserUse } from "./browser-state";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";

const id = TaskIdSchema.parse("browser-state-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-state-test-"));
  const tasksDir = path.join(root, "projects");
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

describe("browser state", () => {
  it("distinguishes unused sessions from recorded browser use", async () => {
    const before = await getBrowserState(taskId, sessionId);
    expect(before._unsafeUnwrap()).toBeUndefined();

    await recordBrowserUse({ sessionId, taskId });

    expect(await getBrowserState(taskId, sessionId)).toMatchObject({
      value: {
        lastUsedAt: expect.any(Date),
      },
    });
  });

  it("preserves the last known page when a later observation has none", async () => {
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserUse({ sessionId, taskId });

    expect(await getBrowserState(taskId, sessionId)).toMatchObject({
      value: {
        lastTitle: "Example",
        lastUrl: "https://example.com",
        lastUsedAt: expect.any(Date),
      },
    });
  });
});
