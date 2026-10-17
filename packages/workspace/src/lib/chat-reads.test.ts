import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
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
import { ChatWrites } from "./chat-writes";
import { addChildTask, touchTask } from "./chat/children";
import { createSession } from "./create-session";
import { isToolPart } from "./is-tool-part";
import { forgetChatFolders } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * What each read of a chat gives back, for a chat written the way the app
 * writes one: its history as the model is sent it, the transcript it is drawn
 * from, the standing facts its session holds, and the lines its own search
 * reads.
 *
 * Dates are frozen except where a test moves the clock on purpose.
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
  const chatId = await chatFor(sessionId);
  (await createSession({ chatId, sessionId }))._unsafeUnwrap();
  return { chatId, sessionId };
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

/** A turn of the chat's: what the user asked and the reply. */
async function writeTurn(
  chatId: ChatId,
  sessionId: StoreId.Session,
  { base64Data = PNG, text = "What is in this folder?" } = {},
): Promise<{
  answered: SessionMessage.WithParts;
  asked: SessionMessage.WithParts;
}> {
  const asked = userMessage(sessionId, text);
  (await ChatWrites.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
  const answered = reply(sessionId, { base64Data });
  (await ChatWrites.saveMessageWithParts(answered, chatId))._unsafeUnwrap();
  return { answered, asked };
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

/** The output of the call that read a file, wherever it is in the history. */
function fileOutput(messages: SessionMessage.WithParts[]): unknown {
  const part = messages
    .flatMap((message) => message.parts)
    .find((each) => each.type === "tool-read_file");
  return part && isToolPart(part) ? part.output : undefined;
}

describe("the reads that build a model request", () => {
  it("gives the chat's history, its task's, and the bytes a call returned", async () => {
    const { chatId, sessionId } = await startChat();
    const { answered, asked } = await writeTurn(chatId, sessionId);
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Count them",
      updatedAt: new Date(),
    });
    const reported = userMessage(task.id, "Eleven files.");
    (await ChatWrites.saveMessageWithParts(reported, chatId))._unsafeUnwrap();

    const history = (
      await ChatReads.modelHistory({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(history).toEqual([asked, answered]);
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
    ).toEqual([asked, reported]);
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
    ).toEqual([asked.id, answered.id]);
    // A task's ids are its own, never its chat's: a task that read its chat's
    // would never look empty, which is what tells a started task from one
    // nobody has written in.
    expect(
      (
        await ChatReads.messageIds({ chatId, sessionId: task.id })
      )._unsafeUnwrap(),
    ).toEqual([reported.id]);
  });

  it("leaves a call whose file is gone an error that says so", async () => {
    const { chatId, sessionId } = await startChat();
    // Bytes of this test's own, so a blob another one read stands for nothing.
    await writeTurn(chatId, sessionId, {
      base64Data: Buffer.from("a chart nobody kept").toString("base64"),
    });

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

  it("dates a session by its newest record, and lets a stop go when a turn starts after it", async () => {
    const { chatId, sessionId } = await startChat();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const { asked } = await writeTurn(chatId, sessionId);
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Count them",
      updatedAt: new Date(),
    });

    // When a session was last updated is the newest record's date, where the
    // store kept the moment its row was last written.
    expect(
      (await ChatReads.session({ chatId, sessionId }))._unsafeUnwrap(),
    ).toMatchObject({
      createdAt: NOW,
      id: sessionId,
      updatedAt: new Date(NOW.getTime() + 60_000),
    });

    // A stop holds until a message starts a turn after it, so a task the
    // person stopped and then sent to reads as running again.
    await touchTask(chatId, task.id, { stoppedBy: "user" });
    expect(
      (await ChatReads.session({ chatId, sessionId: task.id }))._unsafeUnwrap()
        .stoppedBy,
    ).toBe("user");

    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    (
      await ChatWrites.saveMessageWithParts(
        userMessage(task.id, "Carry on."),
        chatId,
      )
    )._unsafeUnwrap();

    expect(
      (await ChatReads.session({ chatId, sessionId: task.id }))._unsafeUnwrap()
        .stoppedBy,
    ).toBeUndefined();
  });
});

describe("the transcript a chat is drawn and told from", () => {
  it("gives both halves of the split, the steps behind the conversation and all", async () => {
    const { chatId, sessionId } = await startChat();
    const { answered, asked } = await writeTurn(chatId, sessionId);

    const transcript = (
      await ChatReads.transcript({ bytes: true, chatId, sessionId })
    )._unsafeUnwrap();
    expect(transcript).toEqual([asked, answered]);
    // What the chat view draws and the reasoning and calls behind it are both
    // in it, in the order the reply made them.
    expect(transcript.at(-1)?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-bash",
      "tool-read_file",
      "text",
    ]);
    expect(fileOutput(transcript)).toMatchObject({ base64Data: PNG });

    // One message alone, for a reader following a change to it.
    expect(
      (
        await ChatReads.transcript({
          bytes: true,
          chatId,
          only: new Set([answered.id]),
          sessionId,
        })
      )._unsafeUnwrap(),
    ).toEqual([answered]);
  });

  it("reads a running turn's parts over the written ones", async () => {
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);

    const replying = underWay(sessionId);
    (await ChatWrites.saveMessage(replying, chatId))._unsafeUnwrap();
    (
      await ChatWrites.savePart(streaming(replying, "Partial"), chatId)
    )._unsafeUnwrap();

    const transcript = (
      await ChatReads.transcript({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(transcript.at(-1)).toMatchObject({
      id: replying.id,
      parts: [{ state: "streaming", text: "Partial" }],
    });

    // The turn ending writes what it was holding, so the words the reply had
    // reached are what the transcript shows from then on.
    await records.service.live(chatId, sessionId).clear();
    expect(
      (await ChatReads.transcript({ chatId, sessionId }))
        ._unsafeUnwrap()
        .at(-1),
    ).toMatchObject({
      id: replying.id,
      parts: [{ state: "done", text: "Partial" }],
    });
  });
});

describe("the standing facts a session was told", () => {
  const schema = z.array(z.object({ path: z.string() }));

  it("reads back what the session was last told, and not an earlier one", async () => {
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);
    await ChatWrites.state(chatId, sessionId, "folders", [{ path: "/a" }]);
    await ChatWrites.state(chatId, sessionId, "folders", [{ path: "/b" }]);

    expect(
      (
        await ChatReads.state({
          chatId,
          schema,
          sessionId,
          what: "folders",
        })
      )._unsafeUnwrap(),
    ).toEqual([{ path: "/b" }]);
  });

  it.each([
    { name: "one never told", state: undefined },
    { name: "one told it no longer holds", state: null },
  ])("answers nothing for $name", async ({ state }) => {
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);
    if (state === null) {
      await ChatWrites.state(chatId, sessionId, "folders", [{ path: "/a" }]);
      await ChatWrites.state(chatId, sessionId, "folders", undefined);
    }

    expect(
      (
        await ChatReads.state({ chatId, schema, sessionId, what: "folders" })
      )._unsafeUnwrap(),
    ).toBeUndefined();
  });

  it("gives a task what its chat was told before it forked", async () => {
    const { chatId, sessionId } = await startChat();
    const { asked } = await writeTurn(chatId, sessionId);
    await ChatWrites.state(chatId, sessionId, "folders", [{ path: "/a" }]);
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Count them",
      updatedAt: new Date(),
    });

    expect(
      (
        await ChatReads.state({
          chatId,
          schema,
          sessionId: task.id,
          what: "folders",
        })
      )._unsafeUnwrap(),
    ).toEqual([{ path: "/a" }]);
  });

  it("answers nothing for a fact written in a shape this build cannot read", async () => {
    const { chatId, sessionId } = await startChat();
    await writeTurn(chatId, sessionId);
    await ChatWrites.state(chatId, sessionId, "folders", { folders: "/a" });

    expect(
      (
        await ChatReads.state({
          chatId,
          schema,
          sessionId,
          what: "folders",
        })
      )._unsafeUnwrap(),
    ).toBeUndefined();
  });
});

describe("what a chat's own search reads", () => {
  it("gives every line somebody said, a task's from its chat's on", async () => {
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
      await ChatWrites.saveMessageWithParts(
        userMessage(task.id, "Two of them."),
        chatId,
      )
    )._unsafeUnwrap();

    const said = (await ChatReads.said({ chatId, sessionId }))._unsafeUnwrap();
    expect(said.map((line) => `${line.role}: ${line.text}`)).toEqual([
      "user: Which of these are overdue?",
      "assistant: One file.",
    ]);
    // A task's lines start with its chat's, up to where it forked.
    expect(
      (await ChatReads.said({ chatId, sessionId: task.id }))
        ._unsafeUnwrap()
        .map((line) => `${line.role}: ${line.text}`),
    ).toEqual(["user: Which of these are overdue?", "user: Two of them."]);
  });
});
