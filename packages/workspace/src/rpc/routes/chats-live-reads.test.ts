import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { recordMessageChanged } from "../../lib/record-changes";
import { sessionOfChat } from "../../lib/record-folders";
import { setWorkspaceActorRef } from "../../lib/workspace-actor-ref";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor, writtenIn } from "../../test/helpers/chat-task";
import { withTestRecords } from "../../test/helpers/with-test-records";
import { type WorkspaceRPCContext } from "../base";
import { chats } from "./chats";
import { session } from "./session";

/**
 * What a chat's live routes read again while a turn streams in: a change to
 * the turn's memory alone (published up to ten times a second per session)
 * moves nothing most of them show, so it reads nothing, where a written one
 * reads again.
 */

const records = withTestRecords();

const context: WorkspaceRPCContext = {
  workspaceConfig: getWorkspaceConfig(),
  workspaceRef: undefined as never,
};

let controller: AbortController;

beforeEach(() => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(records.dir),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "chats-live-reads-")),
    ),
  });
  // No agent is alive in a test; the task list asks the machine whether one is.
  setWorkspaceActorRef({
    getSnapshot: () => ({ context: { sessionRefsByChatId: new Map() } }),
  } as never);
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.restoreAllMocks();
});

/**
 * Every answer a live route gives, pulled as it comes: a route reads again
 * only once its last answer is taken.
 */
function answersOf<T>(live: AsyncIterator<T>): T[] {
  const answers: T[] = [];
  void (async () => {
    for (;;) {
      const next = await live.next().catch(() => ({ done: true as const }));
      if (next.done) {
        return;
      }
      answers.push(next.value);
    }
  })();
  return answers;
}

/** Long enough for a woken route to have started its read. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** An assistant reply of the session's, written, with nothing in it yet. */
async function replyIn(chatId: ChatId, sessionId: StoreId.Session) {
  const reply: SessionMessage.Assistant = {
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
  (await ChatWrites.saveMessage(reply, chatId))._unsafeUnwrap();
  return reply;
}

/** The sessions whose own transcript was read since the spy began. */
function transcriptsRead(spy: { mock: { calls: unknown[][] } }) {
  return new Set(
    spy.mock.calls.map(
      ([ref]) => (ref as { sessionId: StoreId.Session }).sessionId,
    ),
  );
}

describe("chats.live.tasks", () => {
  it("reads only the task a change in memory is to, none for the chat's own turn, and every task for a written one", async () => {
    const chatId = await chatFor();
    await writtenIn(chatId);
    const counting = await chatTaskFor(chatId, { title: "Count the jars" });
    const labeling = await chatTaskFor(chatId, { title: "Label the tins" });
    const answers = answersOf(
      await call(
        chats.live.tasks,
        { id: chatId },
        { context, signal: controller.signal },
      ),
    );
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    const transcript = vi.spyOn(ChatReads, "transcript");

    // The chat's own reply streaming in shows in no task's row.
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("The chat has no session of its own");
    }
    const chatReply = await replyIn(chatId, own);
    transcript.mockClear();
    recordMessageChanged(
      chatId,
      { id: chatReply.id, removed: false, sessionId: own },
      { live: true },
    );
    await settle();
    expect(transcriptsRead(transcript)).toEqual(new Set());

    // A call one task is still typing names its step.
    const reply = await replyIn(chatId, counting);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    transcript.mockClear();
    const turn = records.service.live(chatId, counting);
    turn.setMessage(reply);
    turn.setPart(
      SessionMessagePart.coerce({
        input: { activity: "Counting the jars", command: "ls jar" },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: reply.id,
          sessionId: counting,
        },
        state: "input-streaming",
        toolCallId: "call-1",
        type: "tool-bash",
      }),
    );
    await vi.waitFor(() => {
      expect(answers.at(-1)?.find((task) => task.id === counting)?.step).toBe(
        "Counting the jars",
      );
    });
    expect(transcriptsRead(transcript)).toEqual(new Set([counting]));

    // A written message may move any row, so every task is read.
    transcript.mockClear();
    await replyIn(chatId, labeling);
    await vi.waitFor(() => {
      expect(transcriptsRead(transcript)).toEqual(
        new Set([counting, labeling]),
      );
    });
    await turn.clear();
  });
});

describe("routes that read written records alone", () => {
  it.each([
    [
      "chats.live.asks",
      (id: ChatId) =>
        call(chats.live.asks, { id }, { context, signal: controller.signal }),
    ],
    [
      "chats.live.signIn",
      (id: ChatId) =>
        call(
          chats.live.signIn,
          { id, partId: StoreId.newPartId() },
          { context, signal: controller.signal },
        ),
    ],
    [
      "session.live.contextTokens",
      (id: ChatId) =>
        call(
          session.live.contextTokens,
          { id, sessionId: sessionOfChat(id) ?? StoreId.newSessionId() },
          { context, signal: controller.signal },
        ),
    ],
  ])(
    "%s reads nothing again for a change in memory, and again for a written one",
    async (_name, subscribe) => {
      const chatId = await chatFor();
      await writtenIn(chatId);
      const own = sessionOfChat(chatId);
      if (!own) {
        throw new Error("The chat has no session of its own");
      }
      const answers = answersOf<unknown>(await subscribe(chatId));
      await vi.waitFor(() => {
        expect(answers).toHaveLength(1);
      });
      const read = vi.spyOn(records.service, "read");
      const message = { id: StoreId.newMessageId(), removed: false };

      recordMessageChanged(
        chatId,
        { ...message, sessionId: own },
        { live: true },
      );
      await settle();
      expect(read).not.toHaveBeenCalled();

      recordMessageChanged(chatId, { ...message, sessionId: own });
      await vi.waitFor(() => {
        expect(read).toHaveBeenCalled();
      });
    },
  );
});
