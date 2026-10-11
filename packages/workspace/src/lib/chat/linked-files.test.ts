import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { linkedFiles } from "./linked-files";

vi.mock(import("../session-store-storage"));

// Task state and sessions are real files under the mock workspace, so a task
// id reused across runs would read the last run's conversation.
let counter = 0;
// Chats live under the workspace root, so each test gets a root of its own.
const freshChat = () => {
  const chatId = createMockChatConfig(
    ChatIdSchema.parse(`linked-${Date.now()}-${(counter += 1)}`),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(
      path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "linked-root-")),
        "chats",
      ),
    ),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "linked-root-")),
    ),
  });
  return chatId;
};

/** A chat of the conversation: a session under a title. */
async function chat(_chatId: ChatId, title: string) {
  const sessionId = StoreId.newSessionId();
  chatFor(sessionId);
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title },
    chatFor(sessionId),
  );
  return sessionId;
}

/** A reply in a chat, said at a given moment. */
async function said(
  _chatId: ChatId,
  sessionId: StoreId.Session,
  text: string,
  at: Date,
) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.AssistantWithParts = {
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
  };
  await Store.saveMessageWithParts(message, chatFor(sessionId));
}

const at = (minute: number) => new Date(Date.UTC(2026, 8, 7, 12, minute));

describe("linkedFiles", () => {
  it("names what a reply put on screen, newest first", async () => {
    const chatId = freshChat();
    const sessionId = await chat(chatId, "General");
    await said(
      chatId,
      sessionId,
      "Here is the draft.\n\n```files\noutput/report.md\n```",
      at(1),
    );
    await said(
      chatId,
      sessionId,
      "And the chart: [chart](output/chart.png)",
      at(2),
    );

    const shown = await linkedFiles();

    expect(shown.map((file) => file.path)).toEqual([
      "output/chart.png",
      "output/report.md",
    ]);
  });

  it("reads every chat, since the user saw all of them", async () => {
    const chatId = freshChat();
    const work = await chat(chatId, "Work");
    const home = await chat(chatId, "Home");
    await said(chatId, work, "```files\noutput/deck.pdf\n```", at(1));
    await said(chatId, home, "```files\n/mnt/Documents/plan.md\n```", at(2));

    const shown = await linkedFiles();

    expect(shown.map((file) => file.path)).toEqual([
      "/mnt/Documents/plan.md",
      "output/deck.pdf",
    ]);
  });

  it("leaves a path the reply only talked about out of it", async () => {
    const chatId = freshChat();
    const sessionId = await chat(chatId, "General");
    await said(
      chatId,
      sessionId,
      "I read output/notes.md and wrote this one.\n\n```files\noutput/report.md\n```",
      at(1),
    );

    const shown = await linkedFiles();

    expect(shown.map((file) => file.path)).toEqual(["output/report.md"]);
  });

  it("names a file shown twice once, at the last time it was shown", async () => {
    const chatId = freshChat();
    const sessionId = await chat(chatId, "General");
    await said(chatId, sessionId, "```files\noutput/report.md\n```", at(1));
    await said(chatId, sessionId, "```files\noutput/chart.png\n```", at(2));
    await said(chatId, sessionId, "```files\noutput/report.md\n```", at(3));

    const shown = await linkedFiles();

    const shownIn = chatFor(sessionId);
    expect(shown).toEqual([
      { at: at(3).getTime(), chatId: shownIn, path: "output/report.md" },
      { at: at(2).getTime(), chatId: shownIn, path: "output/chart.png" },
    ]);
  });

  it("names the same path once for each chat that showed it", async () => {
    const chatId = freshChat();
    const first = await chat(chatId, "First");
    const second = await chat(chatId, "Second");
    await said(chatId, first, "```files\n/task/work/notes.md\n```", at(1));
    await said(chatId, second, "```files\n/task/work/notes.md\n```", at(2));

    const shown = await linkedFiles();

    expect(shown.map((file) => file.chatId)).toEqual([
      chatFor(second),
      chatFor(first),
    ]);
  });

  it("has nothing to show for a conversation with no chats", async () => {
    freshChat();

    await expect(linkedFiles()).resolves.toEqual([]);
  });
});
