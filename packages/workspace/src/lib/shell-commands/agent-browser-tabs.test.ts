import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import {
  agentBrowserRuns,
  answerAgentBrowser,
} from "../../test/helpers/agent-browser-runs";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { type BrowserTargetId, browserTargetOf } from "../../types";
import { chatDir } from "../record-folders";
import { sessionLayout } from "../session-layout";
import { getChatState, setChatState } from "../chat-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAgentBrowserCommand } from "./agent-browser";

vi.mock("execa");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const CHAT_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
// A chat of its own per test: a store handle is kept per record id, and
// each test's workspace is a folder of its own.
let counter = 0;
let CHAT_ID = ChatIdSchema.parse("2026-09-26-conversation");
/** The task, a session in the chat's store. */
let TASK_SESSION = StoreId.newSessionId();

let rootDir: string;
let live: Set<BrowserTargetId>;
let asks: { group?: ChatId; show: boolean }[];
let stopAnswering: () => void;

const ctx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

/** A window: answers each page it is asked for with a tab of its own. */
function answeringWindow() {
  return publisher.subscribe("window.tab", (ask) => {
    // The chat's tabs are the pages with a guest up.
    if (ask.action.kind === "list") {
      publisher.publish("window.tabDone", {
        id: ask.id,
        requestId: ask.requestId,
        tabs: [...live].map((id) => ({
          id,
          kind: "page" as const,
          title: "Example",
          url: "https://example.com/",
        })),
      });
      return;
    }
    if (ask.action.kind !== "open" || ask.action.target.kind !== "page") {
      return;
    }
    asks.push({
      show: ask.action.show,
      ...(ask.chatId ? { group: ask.chatId } : {}),
    });
    publisher.publish("window.tabDone", {
      id: ask.id,
      requestId: ask.requestId,
      tabId: StoreId.newSessionId(),
    });
  });
}

/** The browser: a target exists once something creates it, until the test closes it. */
function browserOfLiveTargets() {
  const config = getWorkspaceConfig();
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      createTarget: (targetId) => {
        live.add(targetId);
        return Promise.resolve();
      },
      getTargetMeta: (targetId) =>
        live.has(targetId)
          ? { partitionDir: AbsolutePathSchema.parse(rootDir) }
          : null,
    },
  });
}

async function run(
  args: string[],
  sessionId = TASK_SESSION,
  chatId: ChatId = CHAT_ID,
) {
  await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "" });
  return createAgentBrowserCommand({
    chatId,
    layout: await sessionLayout({ chatId, sessionId }),
    sessionId,
  }).execute(args, ctx);
}

/** Tabs the task drives, on the chat's record. */
async function holdTabs(
  tabs: {
    id: BrowserTargetId;
    inWindow: boolean;
    openedBy: "handed" | "task";
  }[],
) {
  await setChatState(chatDir(CHAT_ID), {
    browserTabs: tabs.map((tab) => ({ ...tab, driver: TASK_SESSION })),
  });
}

async function spawnedCdpUrl() {
  return JSON.stringify((await agentBrowserRuns()).at(-1)?.env);
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-browser-tabs-"));
  createMockChatConfigForDir(path.join(rootDir, "tasks", "unused"), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(
      path.join(path.join(rootDir, "workspace"), "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  counter += 1;
  CHAT_ID = ChatIdSchema.parse(`2026-09-26-conversation-${counter}`);
  await chatFor(CHAT_SESSION, CHAT_ID);
  TASK_SESSION = await chatTaskFor(CHAT_ID, { title: "Read the page" });
  live = new Set();
  asks = [];
  browserOfLiveTargets();
  stopAnswering = answeringWindow();
});

afterEach(async () => {
  stopAnswering();
  vi.resetAllMocks();
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("a chat", () => {
  it("browses in the tabs it holds, through its own browser", async () => {
    const result = await run(["open", "https://example.com"], CHAT_SESSION);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${CHAT_SESSION}`,
    );
    expect(asks).toEqual([]);
  });
});

describe("a task's tab", () => {
  it("connects a task with no tab yet to its browser, which opens one on demand", async () => {
    const result = await run(["open", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    // The task's whole browser, not one page of it.
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${TASK_SESSION}`,
    );
    // Nothing is opened before agent-browser asks the browser for a page.
    expect(asks).toEqual([]);
  });

  it("connects a task to the tabs it holds", async () => {
    const own = browserTargetOf(StoreId.newTabId());
    live.add(own);
    await holdTabs([{ id: own, inWindow: true, openedBy: "task" }]);

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${TASK_SESSION}`,
    );
  });

  it("says so once when its own tabs were closed, then goes on", async () => {
    const chats = browserTargetOf(StoreId.newTabId());
    await holdTabs([
      {
        id: browserTargetOf(StoreId.newTabId()),
        inWindow: true,
        openedBy: "task",
      },
    ]);
    // A tab the chat's own conversation holds is none of the task's.
    const held = await getChatState(chatDir(CHAT_ID));
    await setChatState(chatDir(CHAT_ID), {
      browserTabs: [
        ...held.browserTabs,
        { id: chats, inWindow: true, openedBy: "task" },
      ],
    });

    const told = await run(["snapshot", "-i"]);
    const next = await run(["open", "https://example.com"]);

    expect(told.exitCode).toBe(1);
    expect(told.stderr).toContain("the tabs you opened were closed");
    expect(next.exitCode).toBe(0);
    const state = await getChatState(chatDir(CHAT_ID));
    expect(state.browserTabs).toEqual([
      { id: chats, inWindow: true, openedBy: "task" },
    ]);
  });

  it("drops a page with no tab whose guest went, saying nothing of it", async () => {
    await holdTabs([
      {
        id: browserTargetOf(StoreId.newTabId()),
        inWindow: false,
        openedBy: "task",
      },
    ]);

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(0);
    expect((await getChatState(chatDir(CHAT_ID))).browserTabs).toEqual([]);
  });

  it("is never replaced when it was handed over and the user closed it", async () => {
    await holdTabs([
      {
        id: browserTargetOf(StoreId.newTabId()),
        inWindow: true,
        openedBy: "handed",
      },
    ]);

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the tab this task was handed is closed");
    expect(asks).toEqual([]);
  });

  it.each([
    { args: ["tab", "new", "https://example.com"] },
    { args: ["tab", "list"] },
    { args: ["click", "@e1", "--new-tab"] },
  ])("passes $args through to the task's browser", async ({ args }) => {
    const result = await run(args);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${TASK_SESSION}`,
    );
  });
});
