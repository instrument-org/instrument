import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setChatModel } from "../../lib/chat-settings";
import { recordAsk, recordQuestion } from "../../lib/chat/asks";
import { openAsks } from "../../lib/chat/open-asks";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { ensureChatSession } from "../../lib/create-session";
import { driveAsks } from "../../lib/chat/drive-asks";
import { chatDir, sessionOfChat } from "../../lib/record-folders";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "../../lib/records/chat-records";
import { writeDeviceFile } from "../../lib/records/device-file";
import { newDeviceId } from "../../lib/records/device-id";
import { workspaceLayout } from "../../lib/workspace-layout";
import { type ChatId } from "../../schemas/chat-id";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { writeMessage } from "../../test/helpers/told-history";
import { chats } from "./chats";
import { permissions } from "./permissions";

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
  const written = await setChatModel(
    chatId,
    AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  );
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
          input: {
            questions: [
              {
                choices: [{ label: "Tea" }, { label: "Coffee" }],
                header: "Pick",
                question: "Which one?",
              },
            ],
          },
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
  // What the call's own run records: the question, named by its call.
  await recordQuestion({ chatId, messageId, partId, sessionId }, [
    "Which one?",
  ]);
  return { askId: partId, chatId, messageId, partId, sessionId };
}

it("closes the question, writes the answer onto the call, and wakes the chat with it", async () => {
  const { askId, chatId, messageId, partId, sessionId } = await chatAsking();

  await call(
    chats.answerQuestion,
    { answer: { replies: [{ picked: ["Tea"] }] }, askId, id: chatId },
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
    output: { answer: { replies: [{ picked: ["Tea"] }] }, asked: true },
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
    { answer: { replies: [{ skipped: true }] }, askId, id: chatId },
    { context: context() },
  );

  await expect(
    call(
      chats.answerQuestion,
      { answer: { replies: [{ picked: ["Coffee"] }] }, askId, id: chatId },
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
  expect((await openAsks(chatId)).map((ask) => ask.kind).toSorted()).toEqual([
    "folder",
    "question",
  ]);

  await writeMessage(chatId, sessionId, "user", [
    { state: "done", text: "Tea, please.", type: "text" },
  ]);

  expect((await openAsks(chatId)).map((ask) => ask.kind)).toEqual(["folder"]);
});

it("keeps the question open past a note no one typed", async () => {
  const { chatId, sessionId } = await chatAsking();

  await writeMessage(chatId, sessionId, "user", [
    {
      data: { answer: "allowed", kind: "folder", target: "/Users/me/Pantry" },
      type: "data-permissionAnswer",
    },
  ]);

  expect((await openAsks(chatId)).map((ask) => ask.kind)).toEqual(["question"]);
});

it("closes the chat's questions when the person stops it", async () => {
  const { chatId, sessionId } = await chatAsking();

  (
    await ChatWrites.stopped(chatId, sessionId, "person", new Date())
  )._unsafeUnwrap();

  expect(await openAsks(chatId)).toEqual([]);
});

// Every device writes its own logs into one synced folder; here each is a
// `ChatRecords` of its own over the same chats folder, and the one in place
// is the device the call runs on.
describe("from another computer", () => {
  const owner = () => {
    const records = writingChatRecords();
    if (!records) {
      throw new Error("expected the test's records in place");
    }
    return records;
  };
  const made: ChatRecords[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((records) => records.dispose()));
  });

  /** Another device, its records over the same chats folder. */
  async function computer(name: string) {
    const device = newDeviceId();
    await writeDeviceFile({
      device,
      devicesDir: workspaceLayout(getWorkspaceConfig().rootDir).devicesDir,
      file: { name, platform: "darwin" },
    });
    const records = new ChatRecords({
      app: "0.0.0-test",
      device,
      dirOf: chatDir,
      fsync: false,
    });
    made.push(records);
    return records;
  }

  /** Runs `act` as the device `records` writes for, once it has read what the others wrote. */
  async function on<T>(
    records: ChatRecords,
    chatId: ChatId,
    act: () => Promise<T>,
  ) {
    const home = owner();
    await records.catchUp(chatId);
    installChatRecords(records);
    try {
      return await act();
    } finally {
      installChatRecords(home);
    }
  }

  const answer = (chatId: ChatId, askId: string, picked: string) =>
    call(
      chats.answerQuestion,
      { answer: { replies: [{ picked: [picked] }] }, askId, id: chatId },
      { context: context() },
    );

  it("shows a question answered elsewhere as answered, waiting for the computer that asked", async () => {
    const { askId, chatId } = await chatAsking();
    const phone = await computer("Jeremy's iPhone");
    const laptop = await computer("MacBook Air");

    await on(phone, chatId, () => answer(chatId, askId, "Tea"));

    expect(await on(laptop, chatId, () => openAsks(chatId))).toEqual([
      expect.objectContaining({
        answerable: false,
        answered: {
          answer: { replies: [{ picked: ["Tea"] }] },
          by: "Jeremy's iPhone",
          taken: false,
        },
        here: false,
        kind: "question",
      }),
    ]);
    await expect(
      on(laptop, chatId, () => answer(chatId, askId, "Coffee")),
    ).rejects.toThrow("That question was already answered.");
    expect(sent.filter((event) => event.type === "addMessage")).toEqual([]);
  });

  it("starts one turn for two answers given on two devices at once, with the first", async () => {
    const { askId, chatId, messageId, partId, sessionId } = await chatAsking();
    const phone = await computer("Jeremy's iPhone");
    const laptop = await computer("MacBook Air");
    // Neither had seen the other's answer when it gave its own.
    await Promise.all([phone.catchUp(chatId), laptop.catchUp(chatId)]);
    await phone.answer(chatId, sessionId, {
      ask: askId,
      given: { answer: { replies: [{ picked: ["Tea"] }] }, kind: "question" },
    });
    await laptop.answer(chatId, sessionId, {
      ask: askId,
      given: {
        answer: { replies: [{ picked: ["Coffee"] }] },
        kind: "question",
      },
    });

    await owner().catchUp(chatId);
    await Promise.all([
      driveAsks(chatId, context().workspaceRef),
      driveAsks(chatId, context().workspaceRef),
    ]);

    const woken = sent
      .filter((event) => event.type === "addMessage")
      .flatMap((event) =>
        (event.value.message?.parts ?? []).flatMap((part) =>
          part.type === "data-questionAnswer" ? [part.data.answer.replies] : [],
        ),
      );
    expect(woken).toEqual([[{ picked: ["Tea"] }]]);
    const part = (
      await ChatReads.transcript({
        chatId,
        only: new Set([messageId]),
        sessionId,
      })
    )
      ._unsafeUnwrap()
      .flatMap((message) => message.parts)
      .find((each) => each.metadata.id === partId);
    expect(part).toMatchObject({
      output: { answer: { replies: [{ picked: ["Tea"] }] } },
    });
    expect(await on(laptop, chatId, () => openAsks(chatId))).toEqual([]);
  });
});
