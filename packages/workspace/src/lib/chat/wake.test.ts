import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
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
import { noteTasksInterruptedByQuit, startChatWake } from "./wake";

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
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
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

describe("a stopped task", () => {
  it("wakes the chat saying the user stopped it, and keeps who did on its row", async () => {
    const { chatId, taskSession } = await chatWithTask();

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "user", wakesChat: true },
      sessionId: taskSession,
    });

    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(chatId)[0]).toMatchObject({
      sessionId: taskSession,
      stoppedBy: "user",
      title: "Audit the vault",
    });
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("user");
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
});
