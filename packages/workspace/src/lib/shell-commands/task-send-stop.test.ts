import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeUtf8ToBytes } from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runSend, runStop, type TaskCommandContext } from "./task";

// A chat and a task of their own per test: a store handle is kept per record
// id, and each test's workspace is a folder of its own.
let counter = 0;
let ORCHESTRATOR_ID = TaskIdSchema.parse("2026-09-29-conversation");
let CHILD_ID = TaskIdSchema.parse("write-the-story");

// Whether the child is working, read each time it is asked, so a test can
// have it go idle part way through a wait.
const working = vi.hoisted(() => ({ value: (): boolean => true }));
const sent = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock(import("../orchestrator/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: () => working.value(),
}));

vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      send: (event: unknown) => {
        sent.events.push(event);
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  // Only `ok` and `value` are read; the Result class behind the real return
  // is not a dependency of this package.
  fetchModel: async () =>
    ({ ok: true, value: createMockAIGatewayModel() }) as never,
}));

let context: TaskCommandContext;

let rootDir: string;

beforeEach(async () => {
  counter += 1;
  ORCHESTRATOR_ID = TaskIdSchema.parse(`2026-09-29-conversation-${counter}`);
  CHILD_ID = TaskIdSchema.parse(`write-the-story-${counter}`);
  context = {
    orchestratorTaskId: ORCHESTRATOR_ID,
    remainingYieldMs: () => Number.POSITIVE_INFINITY,
  };
  working.value = () => true;
  sent.events = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-send-stop-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", CHILD_ID));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(StoreId.newSessionId(), ORCHESTRATOR_ID);
  await setTaskState(taskDir(ORCHESTRATOR_ID), {
    selectedModelURI:
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
  });
  const created = await initializeTask(
    {
      initialSettings: {
        name: "Write the story",
        parentTaskId: ORCHESTRATOR_ID,
      },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

function send(args: string[]) {
  return runSend(
    [CHILD_ID, ...args],
    context,
    encodeUtf8ToBytes("Make it about a submarine captain instead."),
    "/",
  );
}

function sentAddMessage() {
  return sent.events.flatMap((event) =>
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "addMessage" &&
    "value" in event &&
    typeof event.value === "object" &&
    event.value !== null &&
    "interrupt" in event.value
      ? [{ interrupt: event.value.interrupt }]
      : [],
  );
}

describe("task send", () => {
  it("leaves a busy task to hear the message at its next step", async () => {
    const result = await send([]);
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Sent to <id>. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.
      "
    `);
    expect(sentAddMessage()).toEqual([{ interrupt: false }]);
  });

  it("stops the step in flight with --now", async () => {
    const result = await send(["--now"]);
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Sent to <id>. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.
      "
    `);
    expect(sentAddMessage()).toEqual([{ interrupt: true }]);
  });

  it("starts an idle task either way", async () => {
    working.value = () => false;
    const result = await send(["--now"]);
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Sent to <id>. It is running now; you will be told when it finishes.
      "
    `);
  });
});

describe("task stop", () => {
  it("says the task stopped once it goes idle", async () => {
    let checks = 0;
    // Working when stop checks first, idle a couple of polls later.
    working.value = () => {
      checks += 1;
      return checks < 3;
    };
    const result = await runStop([CHILD_ID], context);
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Stopped <id>. Its turn ended where it was; \`task send\` gives it the next thing to do.
      "
    `);
    expect(sent.events).toEqual([
      { type: "stopSessions", value: { id: CHILD_ID } },
    ]);
  });

  it("says it is still ending when it does not go idle in time", async () => {
    const result = await runStop([CHILD_ID], {
      ...context,
      remainingYieldMs: () => 700,
    });
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Told <id> to stop, and it is still ending; \`task show <id>\` will say when it has.
      "
    `);
  });

  it("says a task that is not running is not running", async () => {
    working.value = () => false;
    const result = await runStop([CHILD_ID], context);
    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "<id> is not running.
      "
    `);
    expect(sent.events).toEqual([]);
  });
});
