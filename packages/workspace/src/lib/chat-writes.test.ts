import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { withTestRecords } from "../test/helpers/with-test-records";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import {
  archiveChat,
  markChatStopped,
  markChatUnread,
  renameChat,
  setChatStarred,
  setChatTopic,
  settleChatTitle,
} from "./chat/chats";
import { addChildTask, touchTask } from "./chat/children";
import { createTopic } from "./chat/topics";
import { createSession } from "./create-session";
import { recordVisitedHosts } from "./browser-state";
import {
  conversationView,
  listView,
  liveView,
  mergeViews,
  stepsView,
} from "./records/views";
import { forgetChatFolders } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * A chat written through `ChatWrites`: what a read of its records gives back
 * is what the app wrote, for everything a chat is made of.
 *
 * Dates are frozen, so the moment a write is made is the moment the record
 * carries and the two compare exactly.
 */

const records = withTestRecords();

const NOW = new Date("2026-10-14T12:00:00.000Z");

let rootDir: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "chat-writes-")),
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

/** A reply, under way until it is given a `finishedAt`. */
function assistantMessage(
  sessionId: StoreId.Session,
  { finishedAt }: { finishedAt?: Date } = {},
): SessionMessage.Assistant {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt: new Date(),
      ...(finishedAt && { finishedAt }),
      finishReason: finishedAt ? "stop" : "unknown",
      modelId: "test-model",
      providerId: "test-provider",
      sessionId,
    },
    role: "assistant",
  };
}

/** A `bash` call of the reply's, in whichever state it has reached. */
function toolCall(
  message: SessionMessage.Assistant,
  {
    id = StoreId.newPartId(),
    output,
    preliminary,
    state,
  }: {
    id?: StoreId.Part;
    output?: unknown;
    preliminary?: boolean;
    state: "input-available" | "input-streaming" | "output-available";
  },
): SessionMessagePart.Type {
  return SessionMessagePart.coerce({
    input: { command: "ls" },
    metadata: {
      createdAt: new Date(),
      ...(output === undefined ? {} : { endedAt: new Date() }),
      id,
      messageId: message.id,
      sessionId: message.metadata.sessionId,
    },
    ...(output === undefined ? {} : { output }),
    ...(preliminary === undefined ? {} : { preliminary }),
    state,
    toolCallId: `call-${message.id}`,
    type: "tool-bash",
  });
}

/** A part of the reply, as a write takes it. */
function textPart(
  message: SessionMessage.Assistant,
  { state, text }: { state: "done" | "streaming"; text: string },
): SessionMessagePart.Type {
  return {
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: message.id,
      sessionId: message.metadata.sessionId,
    },
    state,
    text,
    type: "text",
  };
}

describe("a chat written through its records", () => {
  it("gives the conversation back as it was written", async () => {
    const { chatId, sessionId } = await startChat();

    const asked = userMessage(sessionId, "What is in this folder?");
    (await ChatWrites.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
    const replying = assistantMessage(sessionId);
    (await ChatWrites.saveMessage(replying, chatId))._unsafeUnwrap();
    const call = toolCall(replying, { state: "input-available" });
    (await ChatWrites.savePart(call, chatId))._unsafeUnwrap();
    const ran = toolCall(replying, {
      id: call.metadata.id,
      output: { exitCode: 0, stdout: "a.md" },
      state: "output-available",
    });
    (
      await ChatWrites.updatePart(
        {
          chatId,
          messageId: replying.id,
          partId: call.metadata.id,
          sessionId,
        },
        () => ran,
      )
    )._unsafeUnwrap();
    const said = textPart(replying, { state: "done", text: "One file." });
    (await ChatWrites.savePart(said, chatId))._unsafeUnwrap();
    const replied = assistantMessage(sessionId, { finishedAt: new Date() });
    (
      await ChatWrites.saveMessage({ ...replied, id: replying.id }, chatId)
    )._unsafeUnwrap();

    const read = await records.service.read(chatId);
    expect(
      mergeViews(
        conversationView(read, sessionId),
        await stepsView(read, sessionId),
      ),
    ).toEqual([
      asked,
      {
        ...replied,
        id: replying.id,
        parts: [ran, said],
      },
    ]);
  });

  it("takes a message retracted out of the conversation", async () => {
    const { chatId, sessionId } = await startChat();
    const kept = userMessage(sessionId, "Keep this one.");
    const dropped = userMessage(sessionId, "Not this one.");
    (await ChatWrites.saveMessageWithParts(kept, chatId))._unsafeUnwrap();
    (await ChatWrites.saveMessageWithParts(dropped, chatId))._unsafeUnwrap();

    (await ChatWrites.retract(chatId, sessionId, [dropped.id]))._unsafeUnwrap();

    const read = await records.service.read(chatId);
    expect(conversationView(read, sessionId)).toEqual([kept]);
  });

  it("keeps the title a chat's own session is first saved with, as a setting", async () => {
    const sessionId = StoreId.newSessionId();
    const chatId = await chatFor(sessionId);
    const now = new Date();

    (
      await ChatWrites.saveSession(
        { createdAt: now, id: sessionId, title: "Trip plans", updatedAt: now },
        chatId,
      )
    )._unsafeUnwrap();

    const read = await records.service.read(chatId);
    expect(read.chat.sessions[0]?.settings.title?.value).toEqual({
      auto: true,
      text: "Trip plans",
    });
    const session = await ChatReads.session({ chatId, sessionId });
    expect(session._unsafeUnwrap().title).toBe("Trip plans");
  });

  it("starts a task's log from the chat it was forked from", async () => {
    const { chatId, sessionId } = await startChat();
    const asked = userMessage(sessionId, "Find three hotels.");
    (await ChatWrites.saveMessageWithParts(asked, chatId))._unsafeUnwrap();

    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Find hotels",
      updatedAt: new Date(),
    });
    const reported = userMessage(task.id, "Three, all near the station.");
    (await ChatWrites.saveMessageWithParts(reported, chatId))._unsafeUnwrap();

    const read = await records.service.read(chatId);
    expect(read.chat.sessions.find(({ id }) => id === task.id)).toMatchObject({
      forkedAt: asked.id,
      handle: "t1",
      parent: sessionId,
      startedAs: "Find hotels",
    });
    // Its history is its chat's up to the fork, then its own.
    expect(
      conversationView(read, task.id).map((message) => message.id),
    ).toEqual([asked.id, reported.id]);
  });

  it("holds a part that is still arriving, and writes the one that settles it", async () => {
    const { chatId, sessionId } = await startChat();
    const replying = assistantMessage(sessionId);
    (await ChatWrites.saveMessage(replying, chatId))._unsafeUnwrap();
    const typing = toolCall(replying, { state: "input-streaming" });

    (await ChatWrites.savePart(typing, chatId))._unsafeUnwrap();
    const streaming = textPart(replying, { state: "streaming", text: "One f" });
    (await ChatWrites.savePart(streaming, chatId))._unsafeUnwrap();

    // Both are the turn's, and a read of the chat shows them without their
    // being written.
    const arriving = await records.service.read(chatId);
    expect(await stepsView(arriving, sessionId)).toEqual([]);
    expect(conversationView(arriving, sessionId)).toEqual([
      { ...replying, parts: [] },
    ]);
    expect(
      liveView(arriving, sessionId).flatMap((message) => message.parts),
    ).toEqual([typing, streaming]);

    const ran = toolCall(replying, {
      id: typing.metadata.id,
      output: { exitCode: 0, stdout: "a.md" },
      state: "output-available",
    });
    (await ChatWrites.savePart(ran, chatId))._unsafeUnwrap();

    const settled = await records.service.read(chatId);
    expect(await stepsView(settled, sessionId)).toEqual([
      { ...replying, parts: [ran] },
    ]);
    // The turn no longer holds what it settled.
    expect(
      liveView(settled, sessionId).flatMap((message) => message.parts),
    ).toEqual([streaming]);
  });

  it("writes a preliminary output only once the call has its own", async () => {
    const { chatId, sessionId } = await startChat();
    const replying = assistantMessage(sessionId);
    (await ChatWrites.saveMessage(replying, chatId))._unsafeUnwrap();
    const call = toolCall(replying, { state: "input-available" });
    (await ChatWrites.savePart(call, chatId))._unsafeUnwrap();
    const ids = {
      chatId,
      messageId: replying.id,
      partId: call.metadata.id,
      sessionId,
    };
    const output = (preliminary: boolean) =>
      toolCall(replying, {
        id: call.metadata.id,
        output: { exitCode: 0, stdout: "a.md" },
        preliminary,
        state: "output-available",
      });

    (await ChatWrites.updatePart(ids, () => output(true)))._unsafeUnwrap();

    const preliminary = await records.service.read(chatId);
    expect(
      (await stepsView(preliminary, sessionId)).flatMap(
        (message) => message.parts,
      ),
    ).toEqual([call]);
    expect(
      liveView(preliminary, sessionId).flatMap((message) => message.parts),
    ).toEqual([output(true)]);

    const own = output(false);
    (await ChatWrites.updatePart(ids, () => own))._unsafeUnwrap();

    const settled = await records.service.read(chatId);
    expect(
      (await stepsView(settled, sessionId)).flatMap((message) => message.parts),
    ).toEqual([own]);
  });

  it("says where a session's context window was reset", async () => {
    const { chatId, sessionId } = await startChat();
    const asked = userMessage(sessionId, "Carry on.");
    (await ChatWrites.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
    const [session] = listView(await records.service.read(chatId));
    if (!session) {
      throw new Error("the chat has no session");
    }

    (
      await ChatWrites.saveSession(
        {
          ...session,
          rolledOverAfterMessageId: asked.id,
          rolledOverUnderUsableTokens: 120_000,
        },
        chatId,
      )
    )._unsafeUnwrap();

    const read = await records.service.read(chatId);
    expect(read.chat.sessions[0]?.rollover).toEqual({
      after: asked.id,
      usableTokens: 120_000,
    });
  });

  it("says who stopped a task's turn, and says it once", async () => {
    const { chatId } = await startChat();
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      id: StoreId.newSessionId(),
      title: "Find hotels",
      updatedAt: new Date(),
    });

    await touchTask(chatId, task.id, { stoppedBy: "person" });
    // The row is written again with the stop it already carries, which says
    // nothing new.
    await touchTask(chatId, task.id);

    const read = await records.service.read(chatId);
    expect(
      read.chat.sessions.find(({ id }) => id === task.id)?.stopped,
    ).toEqual({ at: NOW, by: "person" });
    const log = await fs.readFile(
      path.join(
        records.dirOf(chatId),
        `${task.id}.${records.service.device}.jsonl`,
      ),
      "utf8",
    );
    expect(log.match(/"t":"stop"/g)).toHaveLength(1);
  });

  it("says a second stop by the same person once a turn came between", async () => {
    const { chatId } = await startChat();
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      id: StoreId.newSessionId(),
      title: "Find hotels",
      updatedAt: new Date(),
    });
    await touchTask(chatId, task.id, { stoppedBy: "person" });
    const later = new Date(NOW.getTime() + 1000);
    vi.setSystemTime(later);
    (
      await ChatWrites.saveMessageWithParts(
        userMessage(task.id, "Look in Lisbon too."),
        chatId,
      )
    )._unsafeUnwrap();
    // The turn that message started ends on its own, and its row reads with
    // no stop.
    await touchTask(chatId, task.id);
    const stoppedAgain = new Date(later.getTime() + 1000);
    vi.setSystemTime(stoppedAgain);

    await touchTask(chatId, task.id, { stoppedBy: "person" });

    const read = await records.service.read(chatId);
    expect(
      read.chat.sessions.find(({ id }) => id === task.id)?.stopped,
    ).toEqual({ at: stoppedAgain, by: "person" });
    expect(
      (await ChatReads.session({ chatId, sessionId: task.id }))._unsafeUnwrap()
        .stoppedBy,
    ).toBe("person");
  });

  // Stop on the chat's own turn is a `stop` record in its log, at the
  // moment it was pressed, which the turn's own save of its stop repeats.
  it("writes the person's Stop on the chat's own turn once, as of when they pressed it", async () => {
    const { chatId, sessionId } = await startChat();
    const pressed = new Date(NOW.getTime() - 5000);

    expect(await markChatStopped(chatId, pressed)).toBe(true);
    const session = (
      await ChatReads.session({ chatId, sessionId })
    )._unsafeUnwrap();
    (
      await ChatWrites.saveSession({ ...session, stoppedBy: "person" }, chatId)
    )._unsafeUnwrap();
    expect(
      await markChatStopped(chatId, new Date(pressed.getTime() - 1000)),
    ).toBe(true);

    const read = await records.service.read(chatId);
    expect(
      read.chat.sessions.find(({ id }) => id === sessionId)?.stopped,
    ).toEqual({ at: pressed, by: "person" });
    const log = await fs.readFile(
      path.join(
        records.dirOf(chatId),
        `${sessionId}.${records.service.device}.jsonl`,
      ),
      "utf8",
    );
    expect(log.match(/"t":"stop"/g)).toHaveLength(1);
  });

  // Stop pressed as the turn ends on its own: the press and the turn's save
  // of its stop race, and neither waits for the other.
  it.each(["press first", "save first"])(
    "writes the person's Stop once when it races the turn's own save of it, %s",
    async (order) => {
      const { chatId, sessionId } = await startChat();
      const pressed = new Date(NOW.getTime() - 5000);
      const session = (
        await ChatReads.session({ chatId, sessionId })
      )._unsafeUnwrap();
      const press = () => markChatStopped(chatId, pressed);
      const save = () =>
        ChatWrites.saveSession({ ...session, stoppedBy: "person" }, chatId);

      const [first, second] =
        order === "press first" ? [press(), save()] : [save(), press()];
      await Promise.all([first, second]);

      const log = await fs.readFile(
        path.join(
          records.dirOf(chatId),
          `${sessionId}.${records.service.device}.jsonl`,
        ),
        "utf8",
      );
      expect(log.match(/"t":"stop"/g)).toHaveLength(1);
    },
  );

  it("says each mark the person made, with the moment they made it", async () => {
    const { chatId } = await startChat();
    const topic = await createTopic({ name: "Travel" });

    expect(await renameChat(chatId, "Plans for the trip")).toBe(true);
    expect(await setChatStarred(chatId, true)).toBe(true);
    expect(await archiveChat(chatId)).toBe(true);
    expect(await markChatUnread(chatId, { byUser: true })).toBe(true);
    expect(await setChatTopic(chatId, topic.id)).toBe(true);
    expect(await markChatStopped(chatId, new Date())).toBe(true);
    expect(await settleChatTitle(chatId)).toBe(true);

    expect(listView(await records.service.read(chatId))[0]).toMatchObject({
      archivedAt: NOW,
      starredAt: NOW,
      stoppedBy: "person",
      title: "Plans for the trip",
      titleSettledAt: NOW,
      topic: topic.id,
      unreadAt: NOW,
      unreadByUser: true,
    });

    // A mark taken off again is a mark of its own.
    expect(await setChatStarred(chatId, false)).toBe(true);
    expect(
      listView(await records.service.read(chatId))[0]?.starredAt,
    ).toBeUndefined();
  });

  it("says which sites a session's browser has been on", async () => {
    const { chatId, sessionId } = await startChat();
    (
      await recordVisitedHosts({
        chatId,
        sessionId,
        urls: ["https://example.com/guide"],
      })
    )._unsafeUnwrap();

    expect(
      (await records.service.read(chatId)).chat.sessions[0]?.sites,
    ).toEqual(["example.com"]);
  });
});
