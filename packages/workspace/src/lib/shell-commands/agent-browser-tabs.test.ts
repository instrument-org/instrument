import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { type BrowserTargetId, encodeBrowserTargetId } from "../../types";
import { chatDir } from "../record-folders";
import { getChatState, setChatState } from "../chat-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAgentBrowserCommand } from "./agent-browser";

vi.mock("execa");

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
      createTarget: (id, sessionId) => {
        const targetId = encodeBrowserTargetId(id, sessionId);
        live.add(targetId);
        return Promise.resolve({ targetId });
      },
      getTargetMeta: (targetId) =>
        live.has(targetId)
          ? {
              id: WINDOW_ID,
              partitionDir: AbsolutePathSchema.parse(rootDir),
              sessionId: CHAT_SESSION,
            }
          : null,
    },
  });
}

async function run(
  args: string[],
  sessionId = TASK_SESSION,
  chatId: ChatId = CHAT_ID,
) {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: "",
  } as never);
  return createAgentBrowserCommand({ sessionId, chatId }).execute(args, ctx);
}

/** Tabs the task drives, on the chat's record. */
async function holdTabs(
  tabs: { id: BrowserTargetId; openedBy: "handed" | "task" }[],
) {
  await setChatState(chatDir(CHAT_ID), {
    browserTabs: tabs.map((tab) => ({ ...tab, sessionId: TASK_SESSION })),
  });
}

async function spawnedCdpUrl() {
  const { execa } = await import("execa");
  const call = vi.mocked(execa).mock.calls.at(-1);
  const positional: unknown[] = call ? [...call] : [];
  const options = positional[2];
  const env =
    typeof options === "object" && options !== null && "env" in options
      ? options.env
      : undefined;
  return JSON.stringify(env);
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-browser-tabs-"));
  createMockChatConfigForDir(path.join(rootDir, "tasks", "unused"), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    chatsDir: AbsolutePathSchema.parse(
      path.join(path.join(rootDir, "workspace"), "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  counter += 1;
  CHAT_ID = ChatIdSchema.parse(`2026-09-26-conversation-${counter}`);
  chatFor(CHAT_SESSION, CHAT_ID);
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
    const own = encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId());
    live.add(own);
    await holdTabs([{ id: own, openedBy: "task" }]);

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(
      `/devtools/task/${CHAT_ID}/${TASK_SESSION}`,
    );
  });

  it("says so once when its own tabs were closed, then goes on", async () => {
    const chats = encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId());
    await holdTabs([
      {
        id: encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId()),
        openedBy: "task",
      },
    ]);
    // A tab the chat's own conversation holds is none of the task's.
    const held = await getChatState(chatDir(CHAT_ID));
    await setChatState(chatDir(CHAT_ID), {
      browserTabs: [...held.browserTabs, { id: chats, openedBy: "task" }],
    });

    const told = await run(["snapshot", "-i"]);
    const next = await run(["open", "https://example.com"]);

    expect(told.exitCode).toBe(1);
    expect(told.stderr).toContain("the tab this task opened was closed");
    expect(next.exitCode).toBe(0);
    const state = await getChatState(chatDir(CHAT_ID));
    expect(state.browserTabs).toEqual([{ id: chats, openedBy: "task" }]);
  });

  it("is never replaced when it was handed over and the user closed it", async () => {
    await holdTabs([
      {
        id: encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId()),
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
