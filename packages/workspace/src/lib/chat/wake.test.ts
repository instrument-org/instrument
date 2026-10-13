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
import { chatTaskFor } from "../../test/helpers/chat-task";
import { updateChatSettings } from "../chat-settings";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { taskEventModelNote } from "../task-event-model-text";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { leftRunning } from "./activity";
import { childTask } from "./children";
import { taskStanding } from "./standing";
import {
  hasPendingWake,
  noteTasksInterruptedByQuit,
  startChatWake,
  wakeSessionForPermission,
} from "./wake";

vi.mock(import("../session-store-storage"));

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
  const chatId = chatFor(StoreId.newSessionId());
  const written = await updateChatSettings(chatId, {
    modelURI: AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  });
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
  const messages = await Store.getMessagesWithParts({
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

describe("a stopped task", () => {
  it("writes the chat a note that the user stopped it, starts no turn, and keeps who did on its row", async () => {
    const { chatId, taskSession } = await chatWithTask();

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "user", wakesChat: true },
      sessionId: taskSession,
    });

    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    }, 5000);
    expect((await notesIn(chatId))[0]).toMatchObject({
      sessionId: taskSession,
      stoppedBy: "user",
      title: "Audit the vault",
    });
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("user");
    // Nothing is on its way to start a turn, and nothing was sent.
    expect(hasPendingWake(chatId)).toBe(false);
    expect(wakesOf(chatId)).toEqual([]);
  });

  it("wakes nothing when the chat stopped it, and hears its next turn's end as news", async () => {
    const { chatId, taskSession } = await chatWithTask();

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "chat", wakesChat: false },
      sessionId: taskSession,
    });
    await vi.waitFor(async () => {
      expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("chat");
    });

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(chatId)[0]).not.toHaveProperty("stoppedBy");
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBeUndefined();
  });
});

describe("a task whose request timed out", () => {
  // A timeout is nobody's decision: the chat reads it as a failure it can
  // send the task on from, not as the user's stop.
  it("wakes the chat with a failure that says it timed out", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const now = new Date();
    const labeled = StoreId.newMessageId();
    await Store.saveMessageWithParts(
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
    await Store.saveMessageWithParts(
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
      status: "error",
    });
    expect(event).not.toHaveProperty("stoppedBy");
    expect(
      await taskStanding({ chatId, isRunning: false, sessionId: taskSession }),
    ).toEqual({ kind: "failed", line: "Timed out while reading the vault" });
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

    const woken = wakeSessionForPermission(
      {
        data: { answer: "allowed", kind: "folder", target: "/Users/me/Pantry" },
        type: "data-permissionAnswer",
      },
      workspaceRef,
      chatId,
      [sessionId],
    );
    await vi.waitFor(async () => {
      const messages = await Store.getMessagesWithParts({ chatId, sessionId });
      expect(messages._unsafeUnwrap()).toHaveLength(1);
    });
    expect(hasPendingWake(chatId)).toBe(true);

    found();
    await woken;
    unsubscribe();
    expect(hasPendingWake(chatId)).toBe(false);
    expect(changes.at(-1)).toBe("agent");
  });
});

describe("a task the app's quit cut off", () => {
  it("reads as cut off after relaunch, and leaves the chat a note naming what the quit ended, without starting a turn", async () => {
    const { chatId, taskSession } = await chatWithTask();
    // Mid-turn as the quit lands: a step labeled, its command still going.
    const messageId = StoreId.newMessageId();
    const now = new Date();
    await Store.saveMessageWithParts(
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
    const chatMessages = await Store.getMessagesWithParts({
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
    await Store.saveMessageWithParts(
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
      await Store.getMessagesWithParts({
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
      await Store.getMessageWithParts({
        chatId,
        messageId,
        sessionId: taskSession,
      })
    )
      ._unsafeUnwrap()
      .parts.find((part) => part.metadata.id === partId);
    expect(call).toMatchObject({
      errorText: "This action was interrupted when the app closed.",
      metadata: { endedAt: expect.any(Date) },
      state: "output-error",
    });
  });
});
