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
import { sessionLayout } from "../session-layout";
import { getChatState } from "../chat-record";
import { chatDir } from "../record-folders";
import { notePageOpenedTab, noteTabCommand } from "../tab-activity";
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
  it("browses in the chat's tabs, through its own browser", async () => {
    const result = await run(["open", "https://example.com"], CHAT_SESSION);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${CHAT_SESSION}`,
    );
    expect(asks).toEqual([]);
  });
});

describe("a task's tab", () => {
  it("connects a task to its browser, which opens a tab on demand", async () => {
    const result = await run(["open", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    // The task's whole browser, not one page of it.
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${TASK_SESSION}`,
    );
    // Nothing is opened before agent-browser asks the browser for a page.
    expect(asks).toEqual([]);
  });

  it("ends a result with who else used a tab it drove since its last command there", async () => {
    const shared = browserTargetOf(StoreId.newTabId());
    live.add(shared);
    const at = Date.now();
    noteTabCommand(
      shared,
      { chatId: CHAT_ID, sessionId: TASK_SESSION },
      at - 30_000,
    );
    noteTabCommand(
      shared,
      { chatId: CHAT_ID, sessionId: CHAT_SESSION },
      at - 20_000,
    );
    noteTabCommand(shared, { chatId: CHAT_ID, sessionId: TASK_SESSION }, at);

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Tab ${shared} was used since your last command in it, by the chat`,
    );
    // Told once.
    expect((await run(["snapshot", "-i"])).stdout).toBe("");
  });

  it("names the tab a popup of its page became, as one an agent opened", async () => {
    const shop = browserTargetOf(StoreId.newTabId());
    const popup = StoreId.newTabId();
    live.add(shop);
    // Driven by the command about to run, which the bridge notes as it goes.
    noteTabCommand(
      shop,
      { chatId: CHAT_ID, sessionId: TASK_SESSION },
      Date.now() + 60_000,
    );
    notePageOpenedTab(shop, { tabId: popup, url: "https://help.example/" });

    const result = await run(["click", "@e4"]);

    expect(result.stdout).toContain(
      `The page in tab ${shop} opened https://help.example/ as a popup, which is a new tab of this chat, ${popup}: \`agent-browser tab ${popup}\` switches to it.`,
    );
    expect((await getChatState(chatDir(CHAT_ID))).openedTabs).toEqual([
      { id: popup },
    ]);
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
