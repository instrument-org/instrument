import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { alphabetical } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { withTestRecords } from "../test/helpers/with-test-records";
import { ChatReads } from "./chat-reads";
import { addChildTask, touchTask } from "./chat/children";
import { createSession } from "./create-session";
import { isToolPart } from "./is-tool-part";
import { forgetChatFolders } from "./record-folders";
import { installChatRecords } from "./records/chat-records";
import { Store } from "./store";
import { StoreRecords } from "./store-records";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * The reads that assemble what goes to the model, against the store they came
 * off: for the same chat, written through the store with its records written
 * beside it, the records answer what the store answers.
 *
 * Dates are frozen except where a test moves the clock on purpose, so the
 * moment the store stamps a row is the moment the record beside it carries.
 */

const records = withTestRecords();

const NOW = new Date("2026-10-14T12:00:00.000Z");

/** A one-pixel PNG, as `read_file` returns an image. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let rootDir: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "chat-reads-")),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
  });
  forgetChatFolders();
});

afterEach(async () => {
  vi.useRealTimers();
  forgetChatFolders();
  await removeChatsDir(rootDir);
});

/** A chat with its own session written, as the app writes one. */
async function startChat(): Promise<{
  chatId: ChatId;
  sessionId: StoreId.Session;
}> {
  const sessionId = StoreId.newSessionId();
  const chatId = chatFor(sessionId);
  (await createSession({ chatId, sessionId }))._unsafeUnwrap();
  return { chatId, sessionId };
}

/** Waits for every record the store's writes queued to be in its log. */
async function landed(chatId: ChatId): Promise<void> {
  await StoreRecords.close(chatId);
}

function userMessage(
  sessionId: StoreId.Session,
  text: string,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const metadata = { createdAt: new Date(), sessionId };
  return {
    id,
    metadata,
    parts: [
      {
        metadata: { ...metadata, id: StoreId.newPartId(), messageId: id },
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

/**
 * A reply whose step read a file: what it thought, the call, the file it
 * returned as base64, and the words after it.
 */
function reply(
  sessionId: StoreId.Session,
  { base64Data }: { base64Data: string },
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const metadata = { createdAt: new Date(), sessionId };
  const place = () => ({
    ...metadata,
    endedAt: new Date(),
    id: StoreId.newPartId(),
    messageId: id,
  });
  return {
    id,
    metadata: {
      ...metadata,
      finishedAt: new Date(),
      finishReason: "stop",
      modelId: "test-model",
      providerId: "test-provider",
    },
    parts: [
      {
        metadata: { ...metadata, id: StoreId.newPartId(), messageId: id },
        state: "done",
        text: "Looking in the folder",
        type: "reasoning",
      },
      SessionMessagePart.coerce({
        input: { command: "ls" },
        metadata: place(),
        output: { exitCode: 0, stdout: "chart.png" },
        state: "output-available",
        toolCallId: `call-${id}-bash`,
        type: "tool-bash",
      }),
      SessionMessagePart.coerce({
        input: { path: "/chart.png" },
        metadata: place(),
        output: {
          base64Data,
          filePath: "/chart.png",
          mimeType: "image/png",
          modifiedAt: 1,
          state: "image",
        },
        state: "output-available",
        toolCallId: `call-${id}-read`,
        type: "tool-read_file",
      }),
      {
        metadata: { ...metadata, id: StoreId.newPartId(), messageId: id },
        state: "done",
        text: "One file.",
        type: "text",
      },
    ],
    role: "assistant",
  };
}

/** A turn of the chat's, through the store: what the user asked and the reply. */
async function writeTurn(
  chatId: ChatId,
  sessionId: StoreId.Session,
  { base64Data = PNG, text = "What is in this folder?" } = {},
): Promise<{ asked: SessionMessage.WithParts }> {
  const asked = userMessage(sessionId, text);
  (await Store.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
  (
    await Store.saveMessageWithParts(reply(sessionId, { base64Data }), chatId)
  )._unsafeUnwrap();
  return { asked };
}

/** A reply that has started, with nothing of its own written yet. */
function underWay(sessionId: StoreId.Session): SessionMessage.Assistant {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt: new Date(),
      finishReason: "unknown",
      modelId: "test-model",
      providerId: "test-provider",
      sessionId,
    },
    role: "assistant",
  };
}

/** The words a reply is streaming, which only the turn's memory holds. */
function streaming(
  message: SessionMessage.Assistant,
  text: string,
): SessionMessagePart.Type {
  return {
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: message.id,
      sessionId: message.metadata.sessionId,
    },
    state: "streaming",
    text,
    type: "text",
  };
}

async function storedHistory(chatId: ChatId, sessionId: StoreId.Session) {
  return (
    await Store.getMessagesWithParts({ chatId, sessionId })
  )._unsafeUnwrap();
}

/**
 * The lines the chat command read off a store transcript before the search
 * view answered it: every message somebody said, in words, oldest first.
 */
function storedSaid(messages: SessionMessage.WithParts[]) {
  return alphabetical(messages, (message) => message.id).flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(" ")
      .trim();
    return text ? [{ id: message.id, role: message.role, text }] : [];
  });
}

/** The output of the call that read a file, wherever it is in the history. */
function fileOutput(messages: SessionMessage.WithParts[]): unknown {
  const part = messages
    .flatMap((message) => message.parts)
    .find((each) => each.type === "tool-read_file");
  return part && isToolPart(part) ? part.output : undefined;
}

describe("the reads that build a model request", () => {
  it("gives what the store gives for the same chat, its task and the bytes a call returned", async () => {
    const { chatId, sessionId } = await startChat();
    const { asked } = await writeTurn(chatId, sessionId);
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Count them",
      updatedAt: new Date(),
    });
    const reported = userMessage(task.id, "Eleven files.");
    (await Store.saveMessageWithParts(reported, chatId))._unsafeUnwrap();
    await landed(chatId);

    const stored = await storedHistory(chatId, sessionId);
    const history = (
      await ChatReads.modelHistory({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(history).toEqual(stored);
    // The bytes came back from the blob that holds them, not from the log.
    expect(fileOutput(history)).toMatchObject({ base64Data: PNG });
    expect(await fs.readdir(path.join(records.dirOf(chatId), "blobs"))).toEqual(
      [expect.stringMatching(/^sha256-[0-9a-f]{64}\.png$/)],
    );

    // A task reads its chat's messages up to the fork, then its own.
    expect(
      (
        await ChatReads.modelHistory({ chatId, sessionId: task.id })
      )._unsafeUnwrap(),
    ).toEqual(await storedHistory(chatId, task.id));
    expect(
      (
        await ChatReads.modelHistory({
          chatId,
          inherited: false,
          sessionId: task.id,
        })
      )._unsafeUnwrap(),
    ).toEqual([reported]);

    expect(
      (await ChatReads.messageIds({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(stored.map((message) => message.id));
    expect(
      (
        await ChatReads.messageIds({
          chatId,
          inherited: false,
          sessionId: task.id,
        })
      )._unsafeUnwrap(),
    ).toEqual(
      (await Store.getMessageIds(task.id, chatId))._unsafeUnwrap().toSorted(),
    );
  });

  it("reads the store for a chat whose records hold its header and no message", async () => {
    const { chatId, sessionId } = await startChat();
    await landed(chatId);
    // What an earlier build left: the conversation in the store alone, and
    // records that say the session began and nothing since.
    installChatRecords(undefined);
    await writeTurn(chatId, sessionId);
    installChatRecords(records.service);

    const held = await records.service.read(chatId);
    expect(held.chat.sessions.map(({ id }) => id)).toEqual([sessionId]);
    expect(held.chat.sessions.flatMap((session) => session.messages)).toEqual(
      [],
    );

    const stored = await storedHistory(chatId, sessionId);
    expect(stored).toHaveLength(2);
    expect(
      (await ChatReads.modelHistory({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(stored);
    expect(
      (await ChatReads.messageIds({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(stored.map((message) => message.id));
    expect(
      (await ChatReads.session({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual((await Store.getSession(sessionId, chatId))._unsafeUnwrap());
  });

  it("reads the store where this process writes no records", async () => {
    installChatRecords(undefined);
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);

    expect(
      (await ChatReads.modelHistory({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(await storedHistory(chatId, sessionId));
    expect(await fs.readdir(records.dir)).toEqual([]);
  });

  it("leaves a call whose file is gone an error that says so", async () => {
    const { chatId, sessionId } = await startChat();
    // Bytes of this test's own, so a blob another one read stands for nothing.
    await writeTurn(chatId, sessionId, {
      base64Data: Buffer.from("a chart nobody kept").toString("base64"),
    });
    await landed(chatId);

    const blobs = path.join(records.dirOf(chatId), "blobs");
    for (const name of await fs.readdir(blobs)) {
      await fs.rm(path.join(blobs, name));
    }

    const history = (
      await ChatReads.modelHistory({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(
      history
        .flatMap((message) => message.parts)
        .find((each) => each.type === "tool-read_file"),
    ).toMatchObject({
      errorText:
        "The file this call returned is no longer in the chat's records.",
      state: "output-error",
    });
  });

  it("gives the session the store gives, bar what only the records date", async () => {
    const { chatId, sessionId } = await startChat();
    const stamped = new Date();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const { asked } = await writeTurn(chatId, sessionId);
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Count them",
      updatedAt: new Date(),
    });
    await landed(chatId);

    const storedChat = (
      await Store.getSession(sessionId, chatId)
    )._unsafeUnwrap();
    const chatSession = (
      await ChatReads.session({ chatId, sessionId })
    )._unsafeUnwrap();
    // When a session was last updated is the newest record's date, where the
    // store keeps the moment its row was last written.
    expect(storedChat.updatedAt).toEqual(stamped);
    expect(chatSession.updatedAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect({ ...chatSession, updatedAt: storedChat.updatedAt }).toEqual(
      storedChat,
    );

    // A stop holds until a message starts a turn after it, so a task the
    // person stopped and then sent to reads as running again.
    await touchTask(chatId, task.id, { stoppedBy: "user" });
    await landed(chatId);
    expect(
      (await ChatReads.session({ chatId, sessionId: task.id }))._unsafeUnwrap()
        .stoppedBy,
    ).toBe("user");

    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    (
      await Store.saveMessageWithParts(
        userMessage(task.id, "Carry on."),
        chatId,
      )
    )._unsafeUnwrap();
    await landed(chatId);

    const stoppedTask = (
      await Store.getSession(task.id, chatId)
    )._unsafeUnwrap();
    expect(stoppedTask.stoppedBy).toBe("user");
    expect(
      (await ChatReads.session({ chatId, sessionId: task.id }))._unsafeUnwrap()
        .stoppedBy,
    ).toBeUndefined();
  });
});

describe("the transcript a chat is drawn and told from", () => {
  it("gives what the store gives, the steps behind the conversation and all", async () => {
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);
    await landed(chatId);

    const stored = await storedHistory(chatId, sessionId);
    // Both halves of the split are in it: what the chat view draws, and the
    // reasoning and calls behind it.
    expect(stored.at(-1)?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-bash",
      "tool-read_file",
      "text",
    ]);
    const transcript = (
      await ChatReads.transcript({ bytes: true, chatId, sessionId })
    )._unsafeUnwrap();
    expect(transcript).toEqual(stored);
    expect(fileOutput(transcript)).toMatchObject({ base64Data: PNG });

    // One message alone, for a reader following a change to it.
    const changed = stored.at(-1);
    expect(
      (
        await ChatReads.transcript({
          bytes: true,
          chatId,
          only: new Set(changed ? [changed.id] : []),
          sessionId,
        })
      )._unsafeUnwrap(),
    ).toEqual([changed]);
  });

  it("reads the store for a chat whose records hold its header and no message", async () => {
    const { chatId, sessionId } = await startChat();
    await landed(chatId);
    installChatRecords(undefined);
    await writeTurn(chatId, sessionId);
    installChatRecords(records.service);

    expect(
      (
        await ChatReads.transcript({ bytes: true, chatId, sessionId })
      )._unsafeUnwrap(),
    ).toEqual(await storedHistory(chatId, sessionId));
  });

  it("reads a running turn's parts over the written ones, whichever side holds them", async () => {
    const held = await startChat();
    await writeTurn(held.chatId, held.sessionId);
    await landed(held.chatId);

    // An earlier build's chat: its conversation is the store's alone.
    const stored = await startChat();
    await landed(stored.chatId);
    installChatRecords(undefined);
    await writeTurn(stored.chatId, stored.sessionId);
    installChatRecords(records.service);

    for (const chat of [held, stored]) {
      const replying = underWay(chat.sessionId);
      (await Store.saveMessage(replying, chat.chatId))._unsafeUnwrap();
      const live = records.service.live(chat.chatId, chat.sessionId);
      live.setMessage(replying);
      live.setPart(streaming(replying, "Partial"));

      const transcript = (
        await ChatReads.transcript({
          chatId: chat.chatId,
          sessionId: chat.sessionId,
        })
      )._unsafeUnwrap();
      expect(transcript.at(-1)).toMatchObject({
        id: replying.id,
        parts: [{ state: "streaming", text: "Partial" }],
      });
      live.clear();
    }
  });
});

describe("what a chat's own search reads", () => {
  it("gives the lines the store gave, a task's from its chat's on", async () => {
    const { chatId, sessionId } = await startChat();
    const { asked } = await writeTurn(chatId, sessionId, {
      text: "Which of these are overdue?",
    });
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Check the dates",
      updatedAt: new Date(),
    });
    (
      await Store.saveMessageWithParts(
        userMessage(task.id, "Two of them."),
        chatId,
      )
    )._unsafeUnwrap();
    await landed(chatId);

    const said = (await ChatReads.said({ chatId, sessionId }))._unsafeUnwrap();
    expect(said).toEqual(storedSaid(await storedHistory(chatId, sessionId)));
    expect(said.map((line) => `${line.role}: ${line.text}`)).toEqual([
      "user: Which of these are overdue?",
      "assistant: One file.",
    ]);
    expect(
      (await ChatReads.said({ chatId, sessionId: task.id }))._unsafeUnwrap(),
    ).toEqual(storedSaid(await storedHistory(chatId, task.id)));
  });

  it("reads the store for a chat whose records hold its header and no message", async () => {
    const { chatId, sessionId } = await startChat();
    await landed(chatId);
    installChatRecords(undefined);
    await writeTurn(chatId, sessionId, { text: "Which of these are overdue?" });
    installChatRecords(records.service);

    expect(
      (await ChatReads.said({ chatId, sessionId }))._unsafeUnwrap(),
    ).toEqual(storedSaid(await storedHistory(chatId, sessionId)));
  });
});
