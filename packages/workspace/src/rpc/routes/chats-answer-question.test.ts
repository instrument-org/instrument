import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

import { updateChatSettings } from "../../lib/chat-settings";
import {
  closeQuestions,
  openAsks,
  recordAsk,
  recordQuestion,
} from "../../lib/chat/asks";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { ensureChatSession } from "../../lib/create-session";
import { sessionOfChat } from "../../lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chats } from "./chats";
import { permissions } from "./permissions";

vi.mock(import("../../lib/session-store-storage"));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
}));

const sent: {
  type: string;
  value: { message?: SessionMessage.UserWithParts; sessionId?: string };
}[] = [];

const context = () => ({
  workspaceConfig: getWorkspaceConfig(),
  // A wake reads only `send`, which hands a session its note, so the cast
  // spares the test a workspace machine.
  workspaceRef: {
    send: (event: (typeof sent)[number]) => {
      sent.push(event);
    },
  } as unknown as WorkspaceActorRef,
});

beforeEach(() => {
  sent.length = 0;
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "answer-question-")),
    ),
  });
});

/** A chat someone has written in, whose agent asked a question with `choose`. */
async function chatAsking() {
  const chatId = await chatFor(StoreId.newSessionId());
  const written = await updateChatSettings(chatId, {
    modelURI: AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  });
  if (written.isErr()) {
    throw written.error;
  }
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    throw new Error("expected the chat's session");
  }
  (await ensureChatSession(chatId))._unsafeUnwrap();
  const messageId = StoreId.newMessageId();
  const partId = StoreId.newPartId();
  const saved = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: {
        createdAt: new Date(),
        finishedAt: new Date(),
        finishReason: "stop",
        modelId: "glm-5.3-flash",
        providerId: "openai-compatible",
        sessionId,
      },
      parts: [
        {
          input: { choices: ["Tea", "Coffee"], question: "Which one?" },
          metadata: {
            createdAt: new Date(),
            endedAt: new Date(),
            id: partId,
            messageId,
            sessionId,
          },
          output: { asked: true },
          state: "output-available",
          toolCallId: "call_choose",
          type: "tool-choose",
        },
      ],
      role: "assistant",
    },
    chatId,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
  const askId = await recordQuestion(
    { chatId, messageId, partId, sessionId },
    "Which one?",
  );
  return { askId, chatId, messageId, partId, sessionId };
}

it("closes the question, writes the answer onto the call, and wakes the chat with it", async () => {
  const { askId, chatId, messageId, partId, sessionId } = await chatAsking();

  await call(
    chats.answerQuestion,
    { answer: { selectedChoice: "Tea" }, askId, id: chatId },
    { context: context() },
  );

  expect(await openAsks(chatId)).toEqual([]);
  const transcript = await ChatReads.transcript({
    chatId,
    only: new Set([messageId]),
    sessionId,
  });
  const part = transcript
    ._unsafeUnwrap()
    .flatMap((message) => message.parts)
    .find((each) => each.metadata.id === partId);
  expect(part).toMatchObject({
    output: { answer: { selectedChoice: "Tea" }, asked: true },
  });
  expect(
    sent
      .filter((event) => event.type === "addMessage")
      .map((event) => ({
        parts: event.value.message?.parts.map((woken) => woken.type),
        sessionId: event.value.sessionId,
      })),
  ).toEqual([{ parts: ["data-questionAnswer"], sessionId }]);
});

it("refuses a second answer to the same question", async () => {
  const { askId, chatId } = await chatAsking();
  await call(
    chats.answerQuestion,
    { answer: { declined: true }, askId, id: chatId },
    { context: context() },
  );

  await expect(
    call(
      chats.answerQuestion,
      { answer: { selectedChoice: "Coffee" }, askId, id: chatId },
      { context: context() },
    ),
  ).rejects.toThrow("That question was already answered.");
});

it("keeps a permission answer from closing a question", async () => {
  const { askId, chatId } = await chatAsking();

  await expect(
    call(
      permissions.answer,
      { askId, decision: "allowed", id: chatId },
      { context: context() },
    ),
  ).rejects.toThrow("That request was already answered.");
  expect((await openAsks(chatId)).map((ask) => ask.kind)).toEqual(["question"]);
});

it("closes the chat's questions when the person writes instead, and leaves its permission cards", async () => {
  const { chatId, sessionId } = await chatAsking();
  await recordAsk({ chatId, sessionId }, "folder", "/Users/me/Pantry");

  await closeQuestions(chatId);

  expect((await openAsks(chatId)).map((ask) => ask.kind)).toEqual(["folder"]);
});
