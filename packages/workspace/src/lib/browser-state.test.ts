import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { type BrowserTarget, encodeBrowserTargetId } from "../types";
import {
  allowBrowserReveal,
  BLANK_PAGE_URL,
  getBrowserState,
  recordBrowserUse,
  restoreLastPage,
} from "./browser-state";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { getTaskState, updateTaskPane } from "./task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("browser-state-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

async function pane() {
  const { pane: stored } = await getTaskState(taskDir(taskId));
  return stored ?? TaskPane.EMPTY;
}

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

    expect(
      (await getBrowserState(taskId, sessionId))._unsafeUnwrap(),
    ).toMatchObject({ lastTitle: undefined, lastUrl: "https://example.org" });
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

describe("revealing the browser tab", () => {
  it("puts the pane on the browser when a page is reached", async () => {
    await recordBrowserUse({
      sessionId,
      taskId,
      url: "https://example.com",
    });

    expect(await pane()).toMatchObject({ open: true, selected: "browser" });
  });

  // The whole point: the pane being open already is not the pane being on the
  // right thing, and the reported case was a stale file left over from an
  // earlier turn.
  it("takes the pane off a file the earlier turn left open", async () => {
    await updateTaskPane(taskDir(taskId), (current) =>
      TaskPane.openTabs(current, [TaskPane.fileTab("output/report.html")]),
    );
    expect(await pane()).toMatchObject({
      selected: "file:output/report.html",
    });

    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });

    const after = await pane();
    expect(after).toMatchObject({ open: true, selected: "browser" });
    // Selection, not insertion: the file is still there to go back to.
    expect(after.tabs).toEqual([TaskPane.fileTab("output/report.html")]);
  });

  it("leaves the pane alone when the page has not changed", async () => {
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });
    await updateTaskPane(taskDir(taskId), (current) =>
      TaskPane.openTabs(current, [TaskPane.fileTab("output/report.html")]),
    );

    // What every command that only reads the open page records.
    await recordBrowserUse({
      sessionId,
      taskId,
      title: "Example",
      url: "https://example.com",
    });

    expect(await pane()).toMatchObject({
      selected: "file:output/report.html",
    });
  });

  // The reason it is a latch and not a comparison against what the pane shows:
  // a user who clicked back to a file said where they want to be, and an agent
  // working for minutes would otherwise drag them off it on every page.
  it("does not take the pane a second time in one turn", async () => {
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });
    await updateTaskPane(taskDir(taskId), (current) =>
      TaskPane.openTabs(current, [TaskPane.fileTab("output/report.html")]),
    );

    await recordBrowserUse({ sessionId, taskId, url: "https://example.org" });

    expect(await pane()).toMatchObject({
      selected: "file:output/report.html",
    });
  });

  it("takes the pane again once a new turn asks for something", async () => {
    await recordBrowserUse({ sessionId, taskId, url: "https://example.com" });
    await updateTaskPane(taskDir(taskId), (current) =>
      TaskPane.openTabs(current, [TaskPane.fileTab("output/report.html")]),
    );

    await allowBrowserReveal({ sessionId, taskId });
    await recordBrowserUse({ sessionId, taskId, url: "https://example.org" });

    expect(await pane()).toMatchObject({ open: true, selected: "browser" });
  });

  it.each([
    {
      name: "a target opened for a command that never navigates",
      url: undefined,
    },
    { name: "a browser sitting on the blank page", url: BLANK_PAGE_URL },
  ])("shows nothing for $name", async ({ url }) => {
    await recordBrowserUse({ sessionId, taskId, url });

    expect(await pane()).toMatchObject({ open: false });
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
