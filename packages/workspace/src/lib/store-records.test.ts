import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { withTestRecords } from "../test/helpers/with-test-records";
import {
  archiveChat,
  markChatStopped,
  markChatUnread,
  renameChat,
  setChatStarred,
  setChatTopics,
  settleChatTitle,
} from "./chat/chats";
import { addChildTask, touchTask } from "./chat/children";
import { createTopic } from "./chat/topics";
import { createSession } from "./create-session";
import { getBrowserState, recordVisitedHosts } from "./browser-state";
import { setChatAppsBaseline } from "./chat-app-changes";
import {
  recordMemoryReported,
  resetMemoryReported,
} from "./create-memory-part";
import { getFoldersBaseline, setFoldersBaseline } from "./folders-baseline";
import {
  conversationView,
  listView,
  mergeViews,
  stepsView,
} from "./records/views";
import { forgetChatFolders } from "./record-folders";
import { Store } from "./store";
import { StoreRecords } from "./store-records";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * A chat the store writes while the records are written beside it: what the
 * logs fold to is what the store holds, for everything a chat is made of.
 *
 * Dates are frozen, so the moment the store stamps a row is the moment the
 * record beside it carries and the two compare exactly.
 */

const records = withTestRecords();

const NOW = new Date("2026-10-14T12:00:00.000Z");

let rootDir: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "store-records-")),
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

/** The chat as a fold of its logs reads it, once every append has landed. */
async function recorded(chatId: ChatId) {
  await StoreRecords.close(chatId);
  return records.service.read(chatId);
}

/**
 * Sessions as both sides can be compared: when a session was last updated is
 * a field of the store's own, where the records read it off the date of the
 * newest record.
 */
function comparable(sessions: Session.Type[]) {
  return sessions
    .toSorted((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ updatedAt: _at, ...session }) => session);
}

/** The sessions the store holds, a chat's own and the tasks it started. */
async function storedSessions(chatId: ChatId) {
  return comparable(
    (
      await Store.getSessions(chatId, { includeChildSessions: true })
    )._unsafeUnwrap(),
  );
}

/** What a value reads as once a log has carried it: every date an ISO string. */
function asRecorded(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
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

/** A part of the reply, as the store takes it. */
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

describe("a chat the store writes", () => {
  it("logs the conversation as the store reads it back", async () => {
    const { chatId, sessionId } = await startChat();

    const asked = userMessage(sessionId, "What is in this folder?");
    (await Store.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
    const replying = assistantMessage(sessionId);
    (await Store.saveMessage(replying, chatId))._unsafeUnwrap();
    const call = toolCall(replying, { state: "input-available" });
    (await Store.savePart(call, chatId))._unsafeUnwrap();
    const ran = toolCall(replying, {
      id: call.metadata.id,
      output: { exitCode: 0, stdout: "a.md" },
      state: "output-available",
    });
    (
      await Store.updatePart(
        { messageId: replying.id, partId: call.metadata.id, sessionId },
        () => ran,
        chatId,
      )
    )._unsafeUnwrap();
    (
      await Store.savePart(
        textPart(replying, { state: "done", text: "One file." }),
        chatId,
      )
    )._unsafeUnwrap();
    (
      await Store.saveMessage(
        assistantMessage(sessionId, { finishedAt: new Date() }),
        chatId,
      )
    )._unsafeUnwrap();

    const read = await recorded(chatId);
    expect(
      mergeViews(
        conversationView(read, sessionId),
        await stepsView(read, sessionId),
      ),
    ).toEqual(
      (await Store.getMessagesWithParts({ chatId, sessionId }))._unsafeUnwrap(),
    );
    expect(await storedSessions(chatId)).toEqual(comparable(listView(read)));
  });

  it("takes a message the store removed out of the log too", async () => {
    const { chatId, sessionId } = await startChat();
    const kept = userMessage(sessionId, "Keep this one.");
    const dropped = userMessage(sessionId, "Not this one.");
    (await Store.saveMessageWithParts(kept, chatId))._unsafeUnwrap();
    (await Store.saveMessageWithParts(dropped, chatId))._unsafeUnwrap();

    (await Store.removeMessage(dropped.id, sessionId, chatId))._unsafeUnwrap();

    const read = await recorded(chatId);
    expect(conversationView(read, sessionId)).toEqual(
      (await Store.getMessagesWithParts({ chatId, sessionId }))._unsafeUnwrap(),
    );
    expect(
      conversationView(read, sessionId).map((message) => message.id),
    ).toEqual([kept.id]);
  });

  it("starts a task's log from the chat it was forked from", async () => {
    const { chatId, sessionId } = await startChat();
    const asked = userMessage(sessionId, "Find three hotels.");
    (await Store.saveMessageWithParts(asked, chatId))._unsafeUnwrap();

    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: asked.id,
      id: StoreId.newSessionId(),
      title: "Find hotels",
      updatedAt: new Date(),
    });
    const reported = userMessage(task.id, "Three, all near the station.");
    (await Store.saveMessageWithParts(reported, chatId))._unsafeUnwrap();

    const read = await recorded(chatId);
    const started = read.chat.sessions.find(({ id }) => id === task.id);
    expect(started).toMatchObject({
      forkedAt: asked.id,
      handle: "t1",
      parent: sessionId,
      title: "Find hotels",
    });
    // Its history is its chat's up to the fork, then its own, as the store
    // reads it.
    expect(conversationView(read, task.id)).toEqual(
      (
        await Store.getMessagesWithParts({ chatId, sessionId: task.id })
      )._unsafeUnwrap(),
    );
    expect(await storedSessions(chatId)).toEqual(comparable(listView(read)));
  });

  it("leaves out a part that is still arriving, and logs the one that settles it", async () => {
    const { chatId, sessionId } = await startChat();
    const replying = assistantMessage(sessionId);
    (await Store.saveMessage(replying, chatId))._unsafeUnwrap();
    const typing = toolCall(replying, { state: "input-streaming" });

    (await Store.savePart(typing, chatId))._unsafeUnwrap();
    (
      await Store.savePart(
        textPart(replying, { state: "streaming", text: "One f" }),
        chatId,
      )
    )._unsafeUnwrap();

    const arriving = await recorded(chatId);
    expect(await stepsView(arriving, sessionId)).toEqual([]);
    expect(conversationView(arriving, sessionId)).toEqual([
      { ...replying, parts: [] },
    ]);

    const ran = toolCall(replying, {
      id: typing.metadata.id,
      output: { exitCode: 0, stdout: "a.md" },
      state: "output-available",
    });
    (await Store.savePart(ran, chatId))._unsafeUnwrap();

    const settled = await recorded(chatId);
    expect(await stepsView(settled, sessionId)).toEqual([
      { ...replying, parts: [ran] },
    ]);
  });

  it("logs a preliminary output only once the call has its own", async () => {
    const { chatId, sessionId } = await startChat();
    const replying = assistantMessage(sessionId);
    (await Store.saveMessage(replying, chatId))._unsafeUnwrap();
    const call = toolCall(replying, { state: "input-available" });
    (await Store.savePart(call, chatId))._unsafeUnwrap();
    const ids = { messageId: replying.id, partId: call.metadata.id, sessionId };
    const output = (preliminary: boolean) =>
      toolCall(replying, {
        id: call.metadata.id,
        output: { exitCode: 0, stdout: "a.md" },
        preliminary,
        state: "output-available",
      });

    (await Store.updatePart(ids, () => output(true), chatId))._unsafeUnwrap();

    const preliminary = await recorded(chatId);
    expect(
      (await stepsView(preliminary, sessionId)).flatMap(
        (message) => message.parts,
      ),
    ).toEqual([call]);

    const own = output(false);
    (await Store.updatePart(ids, () => own, chatId))._unsafeUnwrap();

    const settled = await recorded(chatId);
    expect(
      (await stepsView(settled, sessionId)).flatMap((message) => message.parts),
    ).toEqual([own]);
  });

  it("says where a session's context window was reset", async () => {
    const { chatId, sessionId } = await startChat();
    const asked = userMessage(sessionId, "Carry on.");
    (await Store.saveMessageWithParts(asked, chatId))._unsafeUnwrap();
    const session = (await Store.getSession(sessionId, chatId))._unsafeUnwrap();

    (
      await Store.saveSession(
        {
          ...session,
          rolledOverAfterMessageId: asked.id,
          rolledOverUnderUsableTokens: 120_000,
        },
        chatId,
      )
    )._unsafeUnwrap();

    const read = await recorded(chatId);
    expect(read.chat.sessions[0]?.rollover).toEqual({
      after: asked.id,
      usableTokens: 120_000,
    });
    expect(await storedSessions(chatId)).toEqual(comparable(listView(read)));
  });

  it("says who stopped a task's turn, and says it once", async () => {
    const { chatId } = await startChat();
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      id: StoreId.newSessionId(),
      title: "Find hotels",
      updatedAt: new Date(),
    });

    await touchTask(chatId, task.id, { stoppedBy: "user" });
    // The row is written again with the stop it already carries, which says
    // nothing new.
    await touchTask(chatId, task.id);

    const read = await recorded(chatId);
    const stopped = read.chat.sessions.find(({ id }) => id === task.id);
    expect(stopped?.stopped).toEqual({ at: NOW, by: "user" });
    expect(await storedSessions(chatId)).toEqual(comparable(listView(read)));
    const log = await fs.readFile(
      path.join(
        records.dirOf(chatId),
        `${task.id}.${records.service.device}.jsonl`,
      ),
      "utf8",
    );
    expect(log.match(/"t":"stopped"/g)).toHaveLength(1);
  });

  it("says each mark the person made, with the moment they made it", async () => {
    const { chatId } = await startChat();
    const topic = await createTopic({ name: "Travel" });

    expect(await renameChat(chatId, "Plans for the trip")).toBe(true);
    expect(await setChatStarred(chatId, true)).toBe(true);
    expect(await archiveChat(chatId)).toBe(true);
    expect(await markChatUnread(chatId, { byUser: true })).toBe(true);
    expect(await setChatTopics(chatId, [topic.id])).toBe(true);
    expect(await markChatStopped(chatId, new Date())).toBe(true);
    expect(await settleChatTitle(chatId)).toBe(true);

    const read = await recorded(chatId);
    expect(await storedSessions(chatId)).toEqual(comparable(listView(read)));
    expect(comparable(listView(read))[0]).toMatchObject({
      archivedAt: NOW,
      starredAt: NOW,
      stoppedAt: NOW,
      title: "Plans for the trip",
      titleSettledAt: NOW,
      topics: [topic.id],
      unreadAt: NOW,
      unreadByUser: true,
    });

    // A mark taken off again is a mark of its own.
    expect(await setChatStarred(chatId, false)).toBe(true);
    const unstarred = await recorded(chatId);
    expect(await storedSessions(chatId)).toEqual(
      comparable(listView(unstarred)),
    );
    expect(listView(unstarred)[0]?.starredAt).toBeUndefined();
  });

  it("says what a session was last told", async () => {
    const { chatId, sessionId } = await startChat();
    const folders = [{ path: path.join(rootDir, "Trips") }];

    (await setFoldersBaseline(chatId, sessionId, folders))._unsafeUnwrap();
    (
      await setChatAppsBaseline(chatId, sessionId, {
        gmail: { connected: true, name: "Gmail" },
      })
    )._unsafeUnwrap();
    (
      await recordVisitedHosts({
        chatId,
        sessionId,
        urls: ["https://example.com/guide"],
      })
    )._unsafeUnwrap();

    const read = await recorded(chatId);
    const told = read.chat.sessions[0]?.told;
    expect(told?.folders).toEqual(
      asRecorded((await getFoldersBaseline(chatId, sessionId))._unsafeUnwrap()),
    );
    expect(told?.apps).toEqual({ gmail: { connected: true, name: "Gmail" } });
    expect(told?.browser).toEqual(
      asRecorded((await getBrowserState(chatId, sessionId))._unsafeUnwrap()),
    );
  });

  it("says a session has been told nothing of memory again", async () => {
    const { chatId, sessionId } = await startChat();
    await recordMemoryReported({
      chatId,
      memory: undefined,
      name: "trips.md",
      sessionId,
    });

    expect((await recorded(chatId)).chat.sessions[0]?.told.memory).toEqual({});

    await resetMemoryReported({ chatId, sessionId });

    expect(
      (await recorded(chatId)).chat.sessions[0]?.told.memory,
    ).toBeUndefined();
  });
});
