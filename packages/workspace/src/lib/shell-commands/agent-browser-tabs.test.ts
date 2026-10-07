import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { type BrowserTargetId, encodeBrowserTargetId } from "../../types";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAgentBrowserCommand } from "./agent-browser";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

vi.mock("execa");

const CHAT_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
const CHAT_ID = ChatIdSchema.parse("2026-09-26-conversation");
const TASK_ID = TaskIdSchema.parse("read-the-page");

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

async function run(args: string[], taskId = TASK_ID) {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: "",
  } as never);
  return createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId,
  }).execute(args, ctx);
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
  createMockTaskConfigForDir(path.join(rootDir, "tasks", TASK_ID), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(CHAT_SESSION, CHAT_ID);
  const made = await initializeTask(
    {
      chatId: CHAT_ID,
      initialSettings: { name: "Read the page" },
      taskId: TASK_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (made.isErr()) {
    throw made.error;
  }
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
  it("does not browse, and is told to hand the page to a task", async () => {
    const result = await run(["open", "https://example.com"], CHAT_ID);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("a chat does not browse");
    expect(asks).toEqual([]);
  });
});

describe("a task's tab", () => {
  it("connects a task with no tab yet to its browser, which opens one on demand", async () => {
    const result = await run(["open", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    // The task's whole browser, not one page of it.
    expect(await spawnedCdpUrl()).toContain(`/devtools/task/${TASK_ID}`);
    // Nothing is opened before agent-browser asks the browser for a page.
    expect(asks).toEqual([]);
  });

  it("connects a task to the tabs it holds", async () => {
    const own = encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId());
    live.add(own);
    await setTaskState(taskDir(TASK_ID), {
      browserTabs: [{ id: own, openedBy: "task" }],
    });

    const result = await run(["snapshot", "-i"]);

    expect(result.exitCode).toBe(0);
    expect(await spawnedCdpUrl()).toContain(`/devtools/task/${TASK_ID}`);
  });

  it("says so once when its own tabs were closed, then goes on", async () => {
    await setTaskState(taskDir(TASK_ID), {
      browserTabs: [
        {
          id: encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId()),
          openedBy: "task",
        },
      ],
    });

    const told = await run(["snapshot", "-i"]);
    const next = await run(["open", "https://example.com"]);

    expect(told.exitCode).toBe(1);
    expect(told.stderr).toContain("the tab this task opened was closed");
    expect(next.exitCode).toBe(0);
    const state = await getTaskState(taskDir(TASK_ID));
    expect(state.browserTabs).toBeUndefined();
  });

  it("is never replaced when it was handed over and the user closed it", async () => {
    await setTaskState(taskDir(TASK_ID), {
      browserTabs: [
        {
          id: encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId()),
          openedBy: "handed",
        },
      ],
    });

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
    expect(await spawnedCdpUrl()).toContain(`/devtools/task/${TASK_ID}`);
  });
});
