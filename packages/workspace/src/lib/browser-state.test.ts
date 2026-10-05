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
  recordBrowserUse,
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

  it("keeps the last real page when a later observation is the blank one", async () => {
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    // Every command that needs a target but no page reports the blank one. It
    // is not somewhere anyone was, so it must not become what a reopened tab
    // restores or what a teardown notice names.
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "about:blank",
      url: BLANK_PAGE_URL,
    });

    expect(await getBrowserState(taskId, sessionId)).toMatchObject({
      value: { lastTitle: "Example", lastUrl: "https://example.com" },
    });
  });

  it("keeps the page's title when a later command names it without one", async () => {
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    // `show <url>` carries no title. Pointed at the page the session is already
    // on, it is asking for that page to be revealed rather than reporting a
    // different one, so the title it does not carry is still the page's own.
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    expect(await getBrowserState(taskId, sessionId)).toMatchObject({
      value: { lastTitle: "Example", lastUrl: "https://example.com" },
    });
  });

  it("drops the title of the page a new one replaced", async () => {
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserUse({ sessionId, taskId, url: "https://example.org" });

    const state = await getBrowserState(taskId, sessionId);
    expect(state._unsafeUnwrap()?.lastTitle).toBeUndefined();
    expect(state._unsafeUnwrap()?.lastUrl).toBe("https://example.org");
  });

  it("remembers each host the browser has been on, once, newest last", async () => {
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com/a" });
    await recordBrowserUse({ sessionId, taskId, url: "https://example.org" });
    // The same page again is not a visit, and a second page on a host the
    // browser has already been on moves that host to the end rather than
    // naming it twice.
    await recordBrowserUse({ sessionId, taskId, url: "https://example.org" });
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com/b" });
    await recordBrowserUse({ sessionId, taskId, url: BLANK_PAGE_URL });

    const state = await getBrowserState(taskId, sessionId);
    expect(state._unsafeUnwrap()?.visitedHosts).toEqual([
      "example.org",
      "example.com",
    ]);
  });

  it("adds the hosts of a chat task's tabs without taking their page as its own", async () => {
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });
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
        lastUrl: "https://example.com",
        visitedHosts: ["example.com", "example.org"],
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

  it("navigates a blank tab back to the page the session was on", async () => {
    const sendCommand = withTargets([target(BLANK_PAGE_URL)]);
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    const result = await restoreLastPage({ sessionId, targetId, taskId });

    expect(result.isOk()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith(targetId, "Page.navigate", {
      url: "https://example.com",
    });
  });

  it("navigates a blank tab to the page the caller remembers when the session recorded none", async () => {
    const sendCommand = withTargets([target(BLANK_PAGE_URL)]);
    const fresh = StoreId.newSessionId();

    await restoreLastPage({
      fallbackUrl: "https://example.org/remembered",
      sessionId: fresh,
      targetId,
      taskId,
    });

    expect(sendCommand).toHaveBeenCalledWith(targetId, "Page.navigate", {
      url: "https://example.org/remembered",
    });
  });

  it("prefers the page the session recorded to the one the caller remembers", async () => {
    const sendCommand = withTargets([target(BLANK_PAGE_URL)]);
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    await restoreLastPage({
      fallbackUrl: "https://example.org/remembered",
      sessionId,
      targetId,
      taskId,
    });

    expect(sendCommand).toHaveBeenCalledWith(targetId, "Page.navigate", {
      url: "https://example.com",
    });
  });

  it("leaves a tab that already has a page alone", async () => {
    // The ordinary case: this runs on every panel mount, and most find a
    // browser that was never reaped and is still on the page the user left.
    const sendCommand = withTargets([target("https://example.org")]);
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    await restoreLastPage({ sessionId, targetId, taskId });

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
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    const result = await restoreLastPage({ sessionId, targetId, taskId });

    expect(result._unsafeUnwrapErr().message).toBe("guest is gone");
  });
});
