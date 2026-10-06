import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { WorkspaceDirSchema } from "../schemas/paths";
import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { chatBackground } from "./chat-background";
import { createSession } from "./create-session";
import { memoryDir, saveMemory } from "./memory/store";
import { placeTask } from "./record-folders";
import { Store } from "./store";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

let rootDir: string;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-background-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", "unused"), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

function userMessage(
  sessionId: StoreId.Session,
  text: string,
  { fromTask = false } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const meta = { createdAt, id: StoreId.newPartId(), messageId: id, sessionId };
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: [
      { metadata: meta, text, type: "text" },
      ...(fromTask
        ? [
            {
              data: {
                events: [
                  {
                    event: "connected" as const,
                    name: "Linear",
                    slug: "linear",
                  },
                ],
              },
              metadata: { ...meta, id: StoreId.newPartId() },
              type: "data-appEvent" as const,
            },
          ]
        : []),
    ],
    role: "user",
  };
}

async function chatWith(texts: (string | { task: string })[]) {
  const sessionId = StoreId.newSessionId();
  const chatId = chatFor(
    sessionId,
    ChatIdSchema.parse(`2026-10-06-background-${counter}`),
  );
  (await createSession({ sessionId, taskId: chatId }))._unsafeUnwrap();
  const saved = [];
  for (const text of texts) {
    const message =
      typeof text === "string"
        ? userMessage(sessionId, text)
        : userMessage(sessionId, text.task, { fromTask: true });
    (await Store.saveMessageWithParts(message, chatId))._unsafeUnwrap();
    saved.push(message);
  }
  return { chatId, saved, sessionId };
}

describe("chatBackground", () => {
  it("carries the user's own words and memory, and no app's event", async () => {
    await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "You are on Pacific time.",
    });
    const { chatId, sessionId } = await chatWith([
      "I'm willing to consider subscribe and save.",
      { task: "Linear is connected." },
      "Don't check out.",
    ]);

    const background = await chatBackground({
      chatId,
      chatSessionId: sessionId,
      standing: true,
    });

    expect(background?.messages.map((message) => message.text)).toEqual([
      "I'm willing to consider subscribe and save.",
      "Don't check out.",
    ]);
    expect(background?.memories?.map((memory) => memory.text)).toEqual([
      "You are on Pacific time.",
    ]);
  });

  it("forwards only what the task was not given yet", async () => {
    const { chatId, saved, sessionId } = await chatWith(["first", "second"]);
    const taskSessionId = StoreId.newSessionId();
    const taskId = TaskIdSchema.parse(`background-task-${counter}`);
    await fs.mkdir(placeTask(taskId, chatId), { recursive: true });
    (await createSession({ sessionId: taskSessionId, taskId }))._unsafeUnwrap();
    const brief = userMessage(taskSessionId, "the brief");
    brief.parts.push({
      data: {
        messages: [{ id: saved[0]?.id ?? "", sentAt: 0, text: "first" }],
      },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: brief.id,
        sessionId: taskSessionId,
      },
      type: "data-chatBackground",
    });
    (await Store.saveMessageWithParts(brief, taskId))._unsafeUnwrap();

    const background = await chatBackground({
      chatId,
      chatSessionId: sessionId,
      standing: false,
      taskId: taskId satisfies TaskId,
    });

    expect(background?.messages.map((message) => message.text)).toEqual([
      "second",
    ]);
  });

  it("is read ahead of the brief, marked as background", async () => {
    const sessionId = StoreId.newSessionId();
    const message = userMessage(sessionId, "Build the cart in cart.md.");
    message.parts.push({
      data: {
        messages: [{ id: "m1", sentAt: 0, text: "Don't check out." }],
      },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: message.id,
        sessionId,
      },
      type: "data-chatBackground",
    });

    const [model] = await SessionMessage.toModelMessages(
      [message],
      TOOLS_FOR_MODEL_OUTPUT,
      { agentName: "main" },
    );
    const texts = Array.isArray(model?.content)
      ? model.content.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        )
      : [];

    expect(texts[0]).toContain("not your assignment");
    expect(texts[0]).toContain("<user_words>\nDon't check out.\n</user_words>");
    expect(texts.at(-1)).toBe("Build the cart in cart.md.");
  });
});
