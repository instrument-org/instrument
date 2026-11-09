import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { type BrowserTarget, browserTargetOf } from "../types";
import {
  BLANK_PAGE_URL,
  pageOnItsWay,
  recordVisitedHosts,
  restoreLastPage,
} from "./browser-state";
import { ChatReads } from "./chat-reads";
import { chatFor } from "../test/helpers/chat-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const sessionId = StoreId.newSessionId();

// A chat of its own per test: the records hold an open chat by its id, so a
// second chat under one name would still be writing into the folder the test
// before it took away.
let chats = 0;
let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-state-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  chatId = createMockChatConfigForDir(
    path.join(tasksDir, `browser-state-${++chats}`),
  );
  // What a chat was last told is written into its session's log, so the chat
  // holds the session before anything is recorded for it.
  await chatFor(sessionId, chatId);
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("browser state", () => {
  it("adds the hosts of a chat task's tabs, once each, newest last", async () => {
    /** The visit a command reports, with whatever refused the write raised. */
    async function visited(urls: string[]) {
      const recorded = await recordVisitedHosts({ sessionId, chatId, urls });
      if (recorded.isErr()) {
        throw recorded.error;
      }
    }

    expect(
      (await ChatReads.sites({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual([]);
    await visited(["https://example.com/a"]);
    await visited([
      "https://example.org/a",
      BLANK_PAGE_URL,
      "file:///tmp/page.html",
      "https://example.com/b",
      "https://example.org/b",
    ]);

    expect(
      (await ChatReads.sites({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(["example.com", "example.org"]);
  });
});

describe("restoring a reopened tab", () => {
  const targetId = browserTargetOf(StoreId.newTabId());

  function withTargets(targets: BrowserTarget[]) {
    const loadPage = vi.fn(() => Promise.resolve());
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: {
        ...getWorkspaceConfig().browser,
        listTargets: () => Promise.resolve(targets),
        loadPage,
      },
    });
    return loadPage;
  }

  function target(url: string): BrowserTarget {
    return { id: targetId, title: "", type: "page", url };
  }

  it("navigates a blank tab to the page the window remembers", async () => {
    const loadPage = withTargets([target(BLANK_PAGE_URL)]);

    const result = await restoreLastPage({
      fallbackUrl: "https://example.org/remembered",
      targetId,
    });

    expect(result.isOk()).toBe(true);
    expect(loadPage).toHaveBeenCalledWith(
      targetId,
      "https://example.org/remembered",
    );
  });

  it("leaves a tab that already has a page alone", async () => {
    // The ordinary case: this runs on every panel mount, and most find a
    // browser that was never reaped and is still on the page the user left.
    const loadPage = withTargets([target("https://example.org")]);

    await restoreLastPage({
      fallbackUrl: "https://example.com",
      targetId,
    });

    expect(loadPage).not.toHaveBeenCalled();
  });

  it("stands aside while a page the user asked for is on its way, and restores once it has gone", async () => {
    // A window opening a tab at an address sends that open, then draws the
    // tab, whose blank guest asks for a restore of the same target before
    // the address has loaded.
    const loadPage = withTargets([target(BLANK_PAGE_URL)]);
    const noteRestore = vi.fn();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      browser: { ...getWorkspaceConfig().browser, noteRestore },
    });
    const restore = () =>
      restoreLastPage({ fallbackUrl: "https://example.org/typed", targetId });

    const arrived = pageOnItsWay(targetId);
    await restore();

    expect(noteRestore).not.toHaveBeenCalled();
    expect(loadPage).not.toHaveBeenCalled();

    arrived();
    await restore();

    expect(noteRestore).toHaveBeenCalledWith(
      targetId,
      "https://example.org/typed",
    );
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
    });

    expect(result._unsafeUnwrapErr().message).toBe("guest is gone");
  });
});
