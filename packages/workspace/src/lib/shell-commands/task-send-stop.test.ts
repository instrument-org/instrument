import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
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
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { ChatReads } from "../chat-reads";
import { noteTabCommand } from "../tab-activity";
import { browserTargetOf } from "../../types";
import { setChatModel } from "../chat-settings";
import { listChildTasks } from "../chat/children";
import { recordAsk } from "../chat/asks";
import { openAsks } from "../chat/open-asks";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type CapabilityScope } from "../capabilities/context";
import { type HandOff, withHandOffs } from "./task-hand-off";
import { ChatIdSchema } from "../../schemas/chat-id";
import { capabilityRunner } from "../../test/helpers/run-capability";
import { removeChatsDir } from "../../test/helpers/remove-chats-dir";
import { writeMessage } from "../../test/helpers/told-history";
import { publisher } from "../../rpc/publisher";
import { taskEventModelNote } from "../../model-text/notes/task-event-model-text";
import { type WakePart } from "../chat/wake-queue";

const runSend = capabilityRunner("task", "send");
const runStop = capabilityRunner("task", "stop");

// A chat of its own per test: a store handle is kept per record id, and each
// test's workspace is a folder of its own.
let counter = 0;
let CHAT_ID = ChatIdSchema.parse("2026-09-29-conversation");
let CHILD_ID = StoreId.newSessionId();

// Whether the child is working, read each time it is asked, so a test can
// have it go idle part way through a wait.
const working = vi.hoisted(() => ({ value: (): boolean => true }));
const sent = vi.hoisted(() => ({ events: [] as unknown[] }));
const wakes = vi.hoisted(() => ({ parts: [] as WakePart[] }));

vi.mock(import("../chat/wake-queue"), async (importOriginal) => ({
  ...(await importOriginal()),
  enqueueWake: (wake) => {
    const part = typeof wake.part === "function" ? wake.part() : wake.part;
    if (part) {
      wakes.parts.push(part);
    }
    return Promise.resolve();
  },
}));

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

let context: CapabilityScope;

let rootDir: string;

beforeEach(async () => {
  counter += 1;
  CHAT_ID = ChatIdSchema.parse(`2026-09-29-conversation-${counter}`);
  context = {
    chatId: CHAT_ID,
    remainingYieldMs: () => Number.POSITIVE_INFINITY,
    role: "chat",
    sessionId: StoreId.newSessionId(),
  };
  working.value = () => true;
  sent.events = [];
  wakes.parts = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-send-stop-"));
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
  await chatFor(StoreId.newSessionId(), CHAT_ID);
  await setChatModel(
    CHAT_ID,
    AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  );
  CHILD_ID = await chatTaskFor(CHAT_ID, { title: "Write the story" });
});

afterEach(async () => {
  await removeChatsDir(rootDir);
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

  it("reports the send as a hand-off to the bash call, naming the message it delivered", async () => {
    const handOffs: HandOff[] = [];
    await withHandOffs(handOffs, () => send([]));
    const delivered = sent.events.flatMap((event) =>
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
    expect(handOffs).toEqual([
      { kind: "sent", messageId: delivered?.id, sessionId: CHILD_ID },
    ]);
  });

  it("runs the task on the model the chat's picker is on now", async () => {
    const picked =
      "anthropic/claude-opus-5.5?provider=openrouter&providerConfigId=mock-provider-config-id";
    await setChatModel(CHAT_ID, AIGatewayModelURI.Schema.parse(picked));
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
      await ChatReads.transcript({
        inherited: false,
        sessionId: CHILD_ID,
        chatId: CHAT_ID,
      })
    )._unsafeUnwrap();
    expect(own).toHaveLength(1);
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
      "Stopped <id>. Its turn ended where it was; \`instrument task send\` gives it the next thing to do.
      "
    `);
    expect(sent.events).toEqual([
      {
        type: "stopSessions",
        value: {
          id: CHAT_ID,
          notice: { by: "agent", wakesChat: false },
          reason: "chat",
          sessionId: CHILD_ID,
        },
      },
    ]);
  });

  it("passes on what the stopped task last said and the pages it left open", async () => {
    await writeMessage(CHAT_ID, CHILD_ID, "assistant", [
      { text: "Amazon asks for a captcha on the cart page.", type: "text" },
    ]);
    const cart = browserTargetOf(StoreId.newTabId());
    noteTabCommand(cart, { chatId: CHAT_ID, sessionId: CHILD_ID });
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      browser: {
        ...config.browser,
        getTargetAddress: (id) =>
          id === cart ? "https://www.amazon.com/cart" : undefined,
        getTargetMeta: (id) =>
          id === cart ? { partitionDir: AbsolutePathSchema.parse(rootDir) } : null,
      },
    });
    let checks = 0;
    working.value = () => {
      checks += 1;
      return checks < 3;
    };

    const result = await runStop(["t1"], context);

    expect(result.stdout.replaceAll(cart, "<tab>")).toMatchInlineSnapshot(`
      "Stopped t1. Its turn ended where it was; \`instrument task send\` gives it the next thing to do.
      It last said:
          Amazon asks for a captcha on the cart page.
      Its pages still open in the window: https://www.amazon.com/cart (tab <tab>).
      "
    `);
  });

  it("says it is still ending when it does not go idle in time", async () => {
    const result = await runStop(["t1"], {
      ...context,
      remainingYieldMs: () => 700,
    });
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Told <id> to stop; it is still ending, and you will be told when it has.
      "
    `);
    // The chat is told once the task's turn has ended, and not before.
    expect(wakes.parts).toEqual([]);
    publisher.publish("session.done", { id: CHAT_ID, sessionId: CHILD_ID });
    publisher.publish("session.done", { id: CHAT_ID, sessionId: CHILD_ID });
    expect(
      wakes.parts.map((part) =>
        part.type === "data-taskEvent" ? taskEventModelNote(part.data) : part,
      ),
    ).toMatchInlineSnapshot(`
      [
        "
      <instrument-system-note>
      A task you created has finished:
      - t1 ("Write the story") was stopped by you.
      Nobody typed anything; this note is why you are awake. What it found or made is yours to pass on, as the answer, in the conversation as it stands now: a line or two on what it means for the user, with what it made in the files fence, or nothing when they have since moved on or said they do not want it.
      </instrument-system-note>",
      ]
    `);
  });

  it("wakes nothing when the stop sees the task end", async () => {
    let checks = 0;
    working.value = () => {
      checks += 1;
      return checks < 3;
    };
    await runStop(["t1"], context);
    publisher.publish("session.done", { id: CHAT_ID, sessionId: CHILD_ID });
    expect(wakes.parts).toEqual([]);
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
      {
        type: "stopSessions",
        value: {
          id: CHAT_ID,
          notice: { by: "agent", wakesChat: false },
          reason: "chat",
          sessionId: CHILD_ID,
        },
      },
      {
        type: "stopSessions",
        value: {
          id: CHAT_ID,
          notice: { by: "agent", wakesChat: false },
          reason: "chat",
          sessionId: second,
        },
      },
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

  // An answer to the card would otherwise wake the task the chat stopped.
  it("takes a task waiting on a card off it, and marks it stopped by the chat", async () => {
    working.value = () => false;
    await recordAsk(
      { chatId: CHAT_ID, sessionId: CHILD_ID },
      "folder",
      "/Users/me/Documents/Pantry",
    );
    const result = await runStop(["t1"], context);
    expect(result.stdout.replaceAll("t1", "<id>")).toMatchInlineSnapshot(`
      "Stopped <id>, which was waiting on the person's answer to a card; an answer no longer wakes it. \`instrument task send\` gives it the next thing to do.
      "
    `);
    expect(await openAsks(CHAT_ID)).toEqual([]);
    const [task] = await listChildTasks(CHAT_ID);
    expect(task?.stoppedBy).toBe("agent");
    expect(sent.events).toEqual([]);
  });

  it("closes the cards of a working task it stops", async () => {
    let checks = 0;
    working.value = () => {
      checks += 1;
      return checks < 3;
    };
    await recordAsk(
      { chatId: CHAT_ID, sessionId: CHILD_ID },
      "folder",
      "/Users/me/Documents/Pantry",
    );
    await runStop(["t1"], context);
    expect(await openAsks(CHAT_ID)).toEqual([]);
  });
});
