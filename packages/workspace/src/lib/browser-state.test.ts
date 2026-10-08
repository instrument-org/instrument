import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { type BrowserTarget, encodeBrowserTargetId } from "../types";
import {
  BLANK_PAGE_URL,
  getBrowserState,
  recordVisitedHosts,
  restoreLastPage,
} from "./browser-state";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("browser-state-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-state-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

describe("browser state", () => {
  it("adds the hosts of a chat task's tabs, once each, newest last", async () => {
    expect((await getBrowserState(taskId, sessionId))._unsafeUnwrap()).toBe(
      undefined,
    );
    await recordVisitedHosts({
      sessionId,
      taskId,
      urls: ["https://example.com/a"],
    });
    await recordVisitedHosts({
      sessionId,
      taskId,
      urls: [
        "https://example.org/a",
        BLANK_PAGE_URL,
        "file:///tmp/page.html",
        "https://example.com/b",
        "https://example.org/b",
      ],
    });

    expect(await getBrowserState(taskId, sessionId)).toMatchObject({
      value: {
        lastUsedAt: expect.any(Date),
        visitedHosts: ["example.com", "example.org"],
      },
    });
  });
});

describe("restoring a reopened tab", () => {
  const targetId = encodeBrowserTargetId(
    TaskIdSchema.parse("browser-state-test"),
    sessionId,
  );

  function withTargets(targets: BrowserTarget[]) {
    const sendCommand = vi.fn(() => Promise.resolve({}));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve(targets),
        sendCommand,
      },
    });
    return sendCommand;
  }

  function target(url: string): BrowserTarget {
    return { id: targetId, title: "", type: "page", url };
  }

  it("navigates a blank tab to the page the window remembers", async () => {
    const sendCommand = withTargets([target(BLANK_PAGE_URL)]);

    const result = await restoreLastPage({
      fallbackUrl: "https://example.org/remembered",
      targetId,
      taskId,
    });

    expect(result.isOk()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith(targetId, "Page.navigate", {
      url: "https://example.org/remembered",
    });
  });

  it("leaves a tab that already has a page alone", async () => {
    // The ordinary case: this runs on every panel mount, and most find a
    // browser that was never reaped and is still on the page the user left.
    const sendCommand = withTargets([target("https://example.org")]);

    await restoreLastPage({
      fallbackUrl: "https://example.com",
      targetId,
      taskId,
    });

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("reports a guest it cannot reach instead of failing the open", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.reject(new Error("guest is gone")),
      },
    });

    const result = await restoreLastPage({
      fallbackUrl: "https://example.com",
      targetId,
      taskId,
    });

    expect(result._unsafeUnwrapErr().message).toBe("guest is gone");
  });
});
