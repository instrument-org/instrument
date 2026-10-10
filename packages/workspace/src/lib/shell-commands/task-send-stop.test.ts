import { encodeUtf8ToBytes } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type TaskCommandContext } from "./task/context";
import { sendSubcommand } from "./task/send";
import { stopSubcommand } from "./task/stop";
import { type HandOff, withHandOffs } from "./task-hand-off";
import { ChatIdSchema } from "../../schemas/chat-id";
import { subcommandRunner } from "../../test/helpers/run-subcommand";

const runSend = subcommandRunner(sendSubcommand, "task send");
const runStop = subcommandRunner(stopSubcommand, "task stop");

// A chat of its own per test: a store handle is kept per record id, and each
// test's workspace is a folder of its own.
let counter = 0;
let CHAT_ID = ChatIdSchema.parse("2026-09-29-conversation");
let CHILD_ID = StoreId.newSessionId();

// Whether the child is working, read each time it is asked, so a test can
// have it go idle part way through a wait.
const working = vi.hoisted(() => ({ value: (): boolean => true }));
const sent = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock(import("../chat/activity"), async (importOriginal) => ({
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
  fetchModel: () =>
    Promise.resolve({ ok: true, value: createMockAIGatewayModel() }) as never,
}));

let context: TaskCommandContext;

let rootDir: string;

beforeEach(async () => {
  counter += 1;
  CHAT_ID = ChatIdSchema.parse(`2026-09-29-conversation-${counter}`);
  context = {
    chatId: CHAT_ID,
    remainingYieldMs: () => Number.POSITIVE_INFINITY,
  };
  working.value = () => true;
  sent.events = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-send-stop-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", "unused"), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(StoreId.newSessionId(), CHAT_ID);
  await setTaskState(taskDir(CHAT_ID), {
    selectedModelURI:
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
  });
  CHILD_ID = await chatTaskFor(CHAT_ID, { title: "Write the story" });
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

function send(args: string[]) {
  return runSend(
    ["t1", ...args],
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
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Sent to <id>. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.
      "
    `);
    expect(sentAddMessage()).toEqual([{ interrupt: false }]);
  });

  it("stops the step in flight with --now", async () => {
    const result = await send(["--now"]);
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Sent to <id>. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.
      "
    `);
    expect(sentAddMessage()).toEqual([{ interrupt: true }]);
  });

  it("sends the chat's words as the chat's, not as the user's", async () => {
    await send([]);
    const message = sent.events.flatMap((event) =>
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "addMessage" &&
      "value" in event &&
      typeof event.value === "object" &&
      event.value !== null &&
      "message" in event.value
        ? [event.value.message as SessionMessage.WithParts]
        : [],
    )[0];
    expect(message?.parts.filter((part) => part.type === "text")).toEqual([]);
    expect(
      message?.parts.find((part) => part.type === "data-fromChat"),
    ).toMatchObject({
      data: {
        kind: "message",
        text: "Make it about a submarine captain instead.",
      },
    });
  });

  it("reports the send as a hand-off to the bash call", async () => {
    const handOffs: HandOff[] = [];
    await withHandOffs(handOffs, () => send([]));
    expect(handOffs).toEqual([{ kind: "sent", taskId: CHILD_ID }]);
  });

  it("runs the task on the model the chat's picker is on now", async () => {
    const picked =
      "anthropic/claude-opus-5.5?provider=openrouter&providerConfigId=mock-provider-config-id";
    await setTaskState(taskDir(CHAT_ID), { selectedModelURI: picked });
    await send([]);
    expect(
      sent.events.find(
        (event): event is { type: "addMessage"; value: { id: string } } =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "addMessage",
      )?.value,
    ).toMatchObject({ id: CHAT_ID, sessionId: CHILD_ID });
  });

  it("finds the task by its title too", async () => {
    const result = await runSend(
      ["write the story"],
      context,
      encodeUtf8ToBytes("Shorter."),
      "/",
    );
    expect(result.stdout).toContain("Sent to t1.");
  });

  it("writes the message into the task's session, in the chat's store", async () => {
    working.value = () => false;
    await send([]);
    const own = (
      await Store.getMessagesWithParts({
        inherited: false,
        sessionId: CHILD_ID,
        taskId: CHAT_ID,
      })
    )._unsafeUnwrap();
    expect(own).toHaveLength(1);
    expect(
      (await Store.getSession(CHILD_ID, CHAT_ID))._unsafeUnwrap().status,
    ).toBe("running");
  });

  it("starts an idle task either way", async () => {
    working.value = () => false;
    const result = await send(["--now"]);
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
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
    const result = await runStop(["t1"], context);
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Stopped <id>. Its turn ended where it was; \`task send\` gives it the next thing to do.
      "
    `);
    expect(sent.events).toEqual([
      { type: "stopSessions", value: { id: CHAT_ID, sessionId: CHILD_ID } },
    ]);
  });

  it("says it is still ending when it does not go idle in time", async () => {
    const result = await runStop(["t1"], {
      ...context,
      remainingYieldMs: () => 700,
    });
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Told <id> to stop, and it is still ending; \`task list\` will say when it has.
      "
    `);
  });

  // "Stop everything" reads as every task at once, never as a process of the
  // first one's.
  it("stops several tasks named together", async () => {
    const second = await chatTaskFor(CHAT_ID, { title: "Draw the cover" });
    let asked = 0;
    working.value = () => {
      asked += 1;
      // Each is working when stop checks first, and idle on the next poll.
      return asked % 2 === 1;
    };
    const result = await runStop(["t1", "t2"], context);
    expect(result.stdout).toContain("Stopped t1.");
    expect(result.stdout).toContain("Stopped t2.");
    expect(sent.events).toEqual([
      { type: "stopSessions", value: { id: CHAT_ID, sessionId: CHILD_ID } },
      { type: "stopSessions", value: { id: CHAT_ID, sessionId: second } },
    ]);
  });

  it("says a task that is not running is not running", async () => {
    working.value = () => false;
    const result = await runStop(["t1"], context);
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "<id> is not running.
      "
    `);
    expect(sent.events).toEqual([]);
  });
});
