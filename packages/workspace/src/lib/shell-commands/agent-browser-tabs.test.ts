import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { type BrowserTargetId, encodeBrowserTargetId } from "../../types";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAgentBrowserCommand } from "./agent-browser";

vi.mock("execa");

const CHAT_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
const CHAT_ID = TaskIdSchema.parse("2026-09-26-conversation");
const TASK_ID = TaskIdSchema.parse("read-the-page");
const WINDOW_ID = TaskIdSchema.parse("instrument");

let rootDir: string;
let live: Set<BrowserTargetId>;
let asks: { group?: StoreId.Session; show: boolean }[];
let stopAnswering: () => void;

const ctx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

/** A window: answers each page it is asked for with a tab of its own. */
function answeringWindow() {
  return publisher.subscribe("orchestrator.open", (ask) => {
    if (ask.target.kind !== "page") {
      return;
    }
    asks.push({
      show: ask.target.show,
      ...(ask.sessionId ? { group: ask.sessionId } : {}),
    });
    publisher.publish("orchestrator.opened", {
      id: ask.id,
      requestId: ask.target.requestId,
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

async function run(args: string[]) {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: "",
  } as never);
  return createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId: TASK_ID,
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
  for (const id of [WINDOW_ID, TASK_ID]) {
    createMockTaskConfigForDir(path.join(rootDir, "tasks", id));
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(CHAT_SESSION, CHAT_ID);
  for (const [taskId, initialSettings] of [
    [WINDOW_ID, { kind: "orchestrator", name: "Instrument" }],
    [TASK_ID, { name: "Read the page", parentTaskId: CHAT_ID }],
  ] as const) {
    const made = await initializeTask(
      { initialSettings, taskId, workspaceConfig: getWorkspaceConfig() },
      {},
    );
    if (made.isErr()) {
      throw made.error;
    }
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

describe("a task's tab", () => {
  it("opens behind in the task's chat the first time the task needs a page", async () => {
    const result = await run(["open", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    expect(asks).toEqual([{ group: CHAT_SESSION, show: false }]);
    const state = await getTaskState(taskDir(TASK_ID));
    const held = state.browserTabs?.[0];
    expect(held?.openedBy).toBe("task");
    expect(held?.id.startsWith(`${WINDOW_ID}/`)).toBe(true);
    expect(await spawnedCdpUrl()).toContain(held?.id ?? "no tab");
  });

  it("stays the task's page from one command to the next", async () => {
    await run(["open", "https://example.com"]);
    await run(["snapshot", "-i"]);

    expect(asks).toHaveLength(1);
  });

  it("opens again when the user closed the one the task opened", async () => {
    await run(["open", "https://example.com"]);
    live.clear();
    await run(["snapshot", "-i"]);

    expect(asks).toHaveLength(2);
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
    { args: ["window", "new"] },
    { args: ["click", "@e1", "--new-tab"] },
  ])("refuses $args, which would act on its one page", async ({ args }) => {
    const result = await run(args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("this task has one tab");
    expect(asks).toEqual([]);
  });
});
