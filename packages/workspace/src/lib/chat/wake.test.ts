import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor, writtenIn } from "../../test/helpers/chat-task";
import { setChatModel } from "../chat-settings";
import { recordAsk } from "./asks";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { sessionOfChat } from "../record-folders";
import { taskEventModelNote } from "../task-event-model-text";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { leftRunning } from "./activity";
import { childTask } from "./children";
import { taskStanding } from "./standing";
import {
  noteTaskStoppedOnCard,
  noteTasksInterruptedByQuit,
  startChatWake,
  wakeAskers,
  wakeChatWithTaskEvent,
} from "./wake";
import { hasWakeOnItsWay } from "./wake-queue";

// What a task has running lives in this process's process table, which a
// test has none of; a case names it.
vi.mock(import("./activity"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, leftRunning: vi.fn(original.leftRunning) };
});

// The chat's model is looked up to start the turn a wake writes; the turn
// itself is the machine's, which records what it was sent.
vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: vi.fn(() => Promise.resolve({ ok: true, value: {} } as never)),
}));

const sent: unknown[] = [];
const workspaceRef = {
  send: (event: unknown) => {
    sent.push(event);
  },
} as unknown as WorkspaceActorRef;

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wake-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  startChatWake(workspaceRef);
});

/** A chat someone has written in, with one task. */
async function chatWithTask() {
  const { chatId, taskSession } = await chatNobodyWroteIn();
  await writtenIn(chatId);
  return { chatId, taskSession };
}

/**
 * A chat with the model its task runs on and one task, and nothing said in
 * it, as the eval harness runs a task case.
 */
async function chatNobodyWroteIn() {
  const chatId = await chatFor(StoreId.newSessionId());
  const written = await setChatModel(
    chatId,
    AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  );
  if (written.isErr()) {
    throw written.error;
  }
  const taskSession = await chatTaskFor(chatId, { title: "Audit the vault" });
  return { chatId, taskSession };
}

/** The task events of the wakes sent to `chatId`. */
function wakesOf(chatId: string) {
  return sent.flatMap((event) => {
    const { type, value } = event as {
      type: string;
      value: {
        id: string;
        message: { parts: { data?: { events?: unknown[] }; type: string }[] };
      };
    };
    return type === "addMessage" && value.id === chatId
      ? value.message.parts.flatMap((part) => part.data?.events ?? [])
      : [];
  });
}

/** The task events of the notes written into `chatId`'s own session. */
async function notesIn(chatId: ChatId) {
  const messages = await ChatReads.transcript({
    chatId,
    sessionId: sessionOfChat(chatId) ?? StoreId.newSessionId(),
  });
  return messages
    ._unsafeUnwrap()
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "data-taskEvent" ? part.data.events : [],
    );
}

/** A turn of the task's own that ended on words, finished at a fixed time. */
async function saidByTask(
  chatId: ChatId,
  sessionId: StoreId.Session,
  text: string,
) {
  const at = new Date(2026, 9, 13, 9, 0);
  const messageId = StoreId.newMessageId();
  const written = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: {
        createdAt: at,
        finishReason: "stop",
        modelId: "glm-5.3-flash",
        providerId: "openai-compatible",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: at,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text,
          type: "text",
        },
      ],
      role: "assistant",
    },
    chatId,
  );
  if (written.isErr()) {
    throw written.error;
  }
}

describe("a stopped task", () => {
  // A stop that wakes nothing never counts as a wake on its way, however
  // long the stop's processes take to go: the chat is at rest once the
  // task's turn is over.
  it.each([
    ["the person", { by: "person", wakesChat: true }],
    ["the chat", { by: "agent", wakesChat: false }],
    ["the app's quit", { by: "app", wakesChat: false }],
  ] as const)(
    "stopped by %s has no wake on its way from its end",
    async (_who, notice) => {
      const { chatId, taskSession } = await chatWithTask();

      publisher.publish("session.done", {
        id: chatId,
        notice,
        sessionId: taskSession,
      });
      expect(hasWakeOnItsWay(chatId)).toBe(false);
      await vi.waitFor(async () => {
        expect((await childTask(chatId, taskSession))?.stoppedBy).toBe(
          notice.by,
        );
      });
    },
  );

  it("writes the chat a note that the user stopped it, starts no turn, and keeps who did on its row", async () => {
    const { chatId, taskSession } = await chatWithTask();

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "person", wakesChat: true },
      sessionId: taskSession,
    });

    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    }, 5000);
    expect((await notesIn(chatId))[0]).not.toHaveProperty("resumable");
    expect((await notesIn(chatId))[0]).toMatchObject({
      sessionId: taskSession,
      stoppedBy: "person",
      title: "Audit the vault",
    });
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("person");
    // Nothing is on its way to start a turn, and nothing was sent.
    expect(hasWakeOnItsWay(chatId)).toBe(false);
    expect(wakesOf(chatId)).toEqual([]);
  });

  it("wakes nothing when the chat stopped it, and hears its next turn's end as news", async () => {
    const { chatId, taskSession } = await chatWithTask();

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "agent", wakesChat: false },
      sessionId: taskSession,
    });
    await vi.waitFor(async () => {
      expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("agent");
    });

    // Its next turn ended on words rather than on a stop, so the note the
    // chat hears names no stop. The stop itself stays on the record until a
    // message starts a turn after it (`session-of.ts`).
    await saidByTask(chatId, taskSession, "Carrying on.");
    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(chatId)[0]).not.toHaveProperty("stoppedBy");
  });
});

describe("a chat nobody has written in", () => {
  // It has a model for its task to run on, but no conversation to report to.
  // The person's Stop writes its note without the wake's wait, so what a
  // finish would have said shows at once.
  it("hears nothing from its task until someone writes in it", async () => {
    const { chatId, taskSession } = await chatNobodyWroteIn();

    await noteTaskStoppedOnCard(chatId, taskSession, workspaceRef, "person");
    expect(await notesIn(chatId)).toEqual([]);
    expect(hasWakeOnItsWay(chatId)).toBe(false);

    await writtenIn(chatId);
    await noteTaskStoppedOnCard(chatId, taskSession, workspaceRef, "person");
    expect(await notesIn(chatId)).toHaveLength(1);
  });
});

describe("a task whose request timed out", () => {
  // A timeout is nobody's decision: the chat reads it as a failure it can
  // send the task on from, not as the user's stop.
  it("wakes the chat with a failure that says it timed out", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const now = new Date();
    const labeled = StoreId.newMessageId();
    await ChatWrites.saveMessageWithParts(
      {
        id: labeled,
        metadata: {
          createdAt: now,
          finishReason: "tool-calls",
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId: taskSession,
        },
        parts: [
          {
            input: {
              activity: "Reading the vault",
              command: "ls vault",
              explanation: "List the vault",
              yieldMs: 30_000,
            },
            metadata: {
              createdAt: now,
              endedAt: now,
              id: StoreId.newPartId(),
              messageId: labeled,
              sessionId: taskSession,
            },
            output: {
              command: "ls vault",
              commands: ["ls vault"],
              durationMs: 0,
              exitCode: 0,
              omittedBytes: 0,
              output: "notes.md",
            },
            state: "output-available",
            toolCallId: "call_1",
            type: "tool-bash",
          },
        ],
        role: "assistant",
      },
      chatId,
    );
    const cutOff = StoreId.newMessageId();
    await ChatWrites.saveMessageWithParts(
      {
        id: cutOff,
        metadata: {
          createdAt: now,
          error: { kind: "aborted", message: "Aborted", reason: "timeout" },
          finishReason: "aborted",
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId: taskSession,
        },
        parts: [],
        role: "assistant",
      },
      chatId,
    );

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });

    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    const [event] = wakesOf(chatId);
    expect(event).toMatchObject({
      ended: "Timed out while reading the vault",
      resumable: true,
      status: "error",
    });
    expect(event).not.toHaveProperty("stoppedBy");
    expect(
      await taskStanding({ chatId, isRunning: false, sessionId: taskSession }),
    ).toEqual({ kind: "failed", line: "Timed out while reading the vault" });
  });
});

describe("a task whose turn ended on a card", () => {
  // The card it ran into outlives its turn, and the person's answer wakes it:
  // the chat is told the task waits on that answer rather than that it
  // finished, and the task reads as waiting until the card goes.
  it("wakes the chat with the card it waits on, and reads as waiting rather than done", async () => {
    const { chatId, taskSession } = await chatWithTask();
    await recordAsk(
      { chatId, sessionId: taskSession },
      "folder",
      "/Users/me/Pantry",
    );
    await saidByTask(
      chatId,
      taskSession,
      "I can't read /Users/me/Pantry until the person allows it.",
    );

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });

    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    }, 5000);
    const events = await notesIn(chatId);
    expect(events[0]?.needs).toEqual([
      "folder: /Users/me/Pantry, on the card in this chat waiting for the person's answer, which wakes it",
    ]);
    expect(taskEventModelNote({ events })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A task you created is waiting on you:
      - t1 ("Audit the vault") is waiting on you (1 second of work, 0 tokens so far). It said:
            I can't read /Users/me/Pantry until the person allows it.
        It cannot go on without:
            folder: /Users/me/Pantry, on the card in this chat waiting for the person's answer, which wakes it
      Nobody typed anything; this note is why you are awake. Give one waiting on you what you can with \`instrument task send\`, ask the user in one message for the rest, and send it their answer; weigh what it asks of them against what they asked for, and never send it back for a check the user did not ask for. An app it needs is yours to set up and connect with \`connect_app\`; once the note says it is connected, \`instrument task send\` the task on rather than doing its work yourself.
      </instrument-system-note>"
    `);
    expect(
      await taskStanding({ chatId, isRunning: false, sessionId: taskSession }),
    ).toEqual({ kind: "waiting", line: "Waiting for your OK to use “Pantry”" });
  });
});

describe("a wake on its way", () => {
  // A wake writes its note before it has the chat's model to start a turn
  // with, which can take a few tries. The chat is at work all that time, and
  // its row is read again once nothing is on its way.
  it("counts from its note until it reaches the session, then has the chat's row read again", async () => {
    const { chatId } = await chatWithTask();
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("expected the chat's session");
    }
    let found = () => {};
    vi.mocked(fetchModel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          found = () => {
            resolve({ ok: true, value: {} } as never);
          };
        }),
    );
    const changes: string[] = [];
    const unsubscribe = publisher.subscribe("record.changed", (change) => {
      if (change.id === chatId) {
        changes.push(change.kind);
      }
    });

    const woken = wakeAskers(
      {
        data: { answer: "allowed", kind: "folder", target: "/Users/me/Pantry" },
        type: "data-permissionAnswer",
      },
      workspaceRef,
      chatId,
      [sessionId],
    );
    // The person's message, then the note.
    await vi.waitFor(async () => {
      const messages = await ChatReads.transcript({ chatId, sessionId });
      expect(messages._unsafeUnwrap()).toHaveLength(2);
    });
    expect(hasWakeOnItsWay(chatId)).toBe(true);

    found();
    await woken;
    unsubscribe();
    expect(hasWakeOnItsWay(chatId)).toBe(false);
    expect(changes.at(-1)).toBe("agent");
  });
});

describe("a task's finish", () => {
  // The chat is at work from the moment the task's turn ends: what the task
  // said is read for the note before the debounce even starts.
  it("is on its way from the task's end until the chat's turn is asked for", async () => {
    const { chatId, taskSession } = await chatWithTask();
    await saidByTask(chatId, taskSession, "The vault is tidy.");

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    expect(hasWakeOnItsWay(chatId)).toBe(true);

    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    await vi.waitFor(() => {
      expect(hasWakeOnItsWay(chatId)).toBe(false);
    });
  });

  // Two tasks finishing together arrive as one note, and a "still at it"
  // composed before a finish never covers the finish.
  it("takes in what lands during the debounce, keeping a finish over a stale report", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const other = await chatTaskFor(chatId, { title: "Sort the inbox" });
    const event = (sessionId: StoreId.Session, status: "done" | "overdue") => ({
      activeMs: 1000,
      handle: sessionId === taskSession ? "t1" : "t2",
      sessionId,
      status,
      summary: status,
      title: "",
      tokens: 0,
    });

    wakeChatWithTaskEvent(chatId, event(taskSession, "done"), workspaceRef);
    wakeChatWithTaskEvent(chatId, event(other, "overdue"), workspaceRef);
    wakeChatWithTaskEvent(chatId, event(taskSession, "overdue"), workspaceRef);
    wakeChatWithTaskEvent(chatId, event(other, "done"), workspaceRef);

    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(2);
    }, 5000);
    expect(
      wakesOf(chatId).map((each) => (each as { summary: string }).summary),
    ).toEqual(["done", "done"]);
  });
});

describe("a task the app's quit cut off", () => {
  it("reads as cut off after relaunch, and leaves the chat a note naming what the quit ended, without starting a turn", async () => {
    const { chatId, taskSession } = await chatWithTask();
    // Mid-turn as the quit lands: a step labeled, its command still going.
    const messageId = StoreId.newMessageId();
    const now = new Date();
    await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: {
          createdAt: now,
          finishReason: "tool-calls",
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId: taskSession,
        },
        parts: [
          {
            input: {
              activity: "Counting to a million",
              command: "fg bg_1",
              yieldMs: 30_000,
              explanation: "Wait for the count",
            },
            metadata: {
              createdAt: now,
              id: StoreId.newPartId(),
              messageId,
              sessionId: taskSession,
            },
            state: "input-available",
            toolCallId: "call_1",
            type: "tool-bash",
          },
        ],
        role: "assistant",
      },
      chatId,
    );
    vi.mocked(leftRunning).mockReturnValueOnce([
      { command: "python count.py", id: "bg_1", runningForMs: 600_000 },
    ]);
    const sentBefore = sent.length;

    await noteTasksInterruptedByQuit([
      { chatId, sessionId: taskSession },
      // The chat's own session is alive too, and is no task to report.
      { chatId, sessionId: sessionOfChat(chatId) ?? taskSession },
    ]);

    // The relaunched app reads the task from its store alone.
    expect(
      await taskStanding({ chatId, isRunning: false, sessionId: taskSession }),
    ).toMatchInlineSnapshot(`
      {
        "kind": "failed",
        "line": "The app closed while counting to a million",
      }
    `);
    expect(sent.slice(sentBefore)).toEqual([]);
    const chatMessages = await ChatReads.transcript({
      chatId,
      sessionId: sessionOfChat(chatId) ?? taskSession,
    });
    const notes = chatMessages
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .flatMap((part) =>
        part.type === "data-taskEvent" ? [taskEventModelNote(part.data)] : [],
      );
    expect(notes).toMatchInlineSnapshot(`
      [
        "
      <instrument-system-note>
      The app closed while a task you created was working:
      - t1 ("Audit the vault") did not finish: the app closed while counting to a million (1 second of work, 0 tokens so far).
        The app's closing also ended what it had running in the background: bg_1 \`python count.py\` (10 minutes). None of it is running now.
      The app has been opened again since, and nothing ran while it was closed.
      </instrument-system-note>",
      ]
    `);
  });

  // A loop writing a line a second for two minutes is one call open the
  // whole time: the run is the step that asked for it and the call, up to
  // the quit, not the step alone.
  it("counts the call the quit cut off in how long the task worked", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const messageId = StoreId.newMessageId();
    const partId = StoreId.newPartId();
    const now = Date.now();
    const stepAt = new Date(now - 120_000);
    const callAt = new Date(now - 118_000);
    await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: {
          createdAt: stepAt,
          finishedAt: callAt,
          finishReason: "tool-calls",
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId: taskSession,
        },
        parts: [
          {
            input: {
              activity: "Writing the log",
              command:
                "for i in $(seq 200); do echo $i >> log.txt; sleep 1; done",
              explanation: "Write a line a second",
              yieldMs: 300_000,
            },
            metadata: {
              createdAt: callAt,
              id: partId,
              messageId,
              sessionId: taskSession,
              startedAt: callAt,
            },
            state: "input-available",
            toolCallId: "call_1",
            type: "tool-bash",
          },
        ],
        role: "assistant",
      },
      chatId,
    );

    await noteTasksInterruptedByQuit([{ chatId, sessionId: taskSession }]);

    const notes = (
      await ChatReads.transcript({
        chatId,
        sessionId: sessionOfChat(chatId) ?? taskSession,
      })
    )
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .flatMap((part) =>
        part.type === "data-taskEvent" ? [taskEventModelNote(part.data)] : [],
      );
    expect(notes).toMatchInlineSnapshot(`
      [
        "
      <instrument-system-note>
      The app closed while a task you created was working:
      - t1 ("Audit the vault") did not finish: the app closed while writing the log (2 minutes of work, 0 tokens so far).
      The app has been opened again since, and nothing ran while it was closed.
      </instrument-system-note>",
      ]
    `);
    const call = (
      await ChatReads.transcript({
        chatId,
        only: new Set([messageId]),
        sessionId: taskSession,
      })
    )
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .find((part) => part.metadata.id === partId);
    expect(call).toMatchObject({
      errorText: "This action was interrupted when the app closed.",
      metadata: { endedAt: expect.any(Date) },
      state: "output-error",
    });
  });
});
