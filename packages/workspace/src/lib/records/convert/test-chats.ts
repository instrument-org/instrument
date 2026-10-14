import fs from "node:fs/promises";
import superjson from "superjson";

import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../../constants";
import { type ChatId } from "../../../schemas/chat-id";
import { type Session } from "../../../schemas/session";
import { SessionMessage } from "../../../schemas/session/message";
import { SessionMessagePart } from "../../../schemas/session/message-part";
import { SessionMessageRelaxedPart } from "../../../schemas/session/message-relaxed-part";
import { type StoreId } from "../../../schemas/store-id";
import { createMockChatConfigForDir } from "../../../test/helpers/mock-chat-config";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
} from "../../session-store-storage";
import { StorageKey } from "../../storage-key";
import { Store } from "../../store";
import { at, messageId, partId, sessionId } from "../test-records";

/**
 * Chats written through today's store, for the converter's tests: each
 * `chat.db` made by the store's own writes and closed again, as a chat is
 * when the app quits.
 */

export const CHAT_SESSION = sessionId(1);
export const TASK_SESSION = sessionId(2);

/** Bytes standing in for an image and a PDF a tool read. */
const IMAGE = Buffer.from("an image's bytes");
const PDF = Buffer.from("a PDF's bytes");

/** Makes the chat whose record folder is `dir` with `write`, then closes its store. */
export async function writeChat(
  dir: string,
  write: (chat: ChatId) => Promise<void>,
): Promise<ChatId> {
  const chat = createMockChatConfigForDir(dir);
  await fs.mkdir(dir, { recursive: true });
  await write(chat);
  await disposeSessionsStoreStorage(chat);
  return chat;
}

export async function saveSession(
  chat: ChatId,
  session: Session.Type,
): Promise<void> {
  (await Store.saveSession(session, chat))._unsafeUnwrap();
}

/** Saves a message with its parts, each part given as the store keeps it. */
export async function saveMessage(
  chat: ChatId,
  message: Record<string, unknown>,
  parts: SessionMessagePart.Type[] = [],
): Promise<void> {
  (
    await Store.saveMessageWithParts(
      { ...SessionMessage.Schema.parse(message), parts },
      chat,
    )
  )._unsafeUnwrap();
}

/** A part numbered `n`, as the store reads one back. */
export function part(
  session: StoreId.Session,
  message: StoreId.Message,
  n: number,
  fields: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): SessionMessagePart.Type {
  return SessionMessagePart.coerce(
    SessionMessageRelaxedPart.Schema.parse({
      ...fields,
      metadata: {
        createdAt: at(n),
        id: partId(n),
        messageId: message,
        sessionId: session,
        ...metadata,
      },
    }),
  );
}

/** Stores what a session was told, as each fact's module stores it. */
export async function tell(
  chat: ChatId,
  key: string,
  value: unknown,
): Promise<void> {
  const storage = (await getSessionsStoreStorage(chat))._unsafeUnwrap();
  (await storage.setItemRaw(key, superjson.stringify(value)))._unsafeUnwrap();
}

function assistant(session: StoreId.Session, n: number) {
  return {
    id: messageId(n),
    metadata: {
      createdAt: at(n),
      finishReason: "tool-calls",
      finishedAt: at(n + 1),
      modelId: "test-model",
      providerId: "test-provider",
      sessionId: session,
      usage: {
        inputTokenDetails: { cacheReadTokens: 10, noCacheTokens: 90 },
        inputTokens: 100,
        outputTokenDetails: { reasoningTokens: 5, textTokens: 15 },
        outputTokens: 20,
        totalTokens: 120,
      },
    },
    role: "assistant",
  };
}

function user(session: StoreId.Session, n: number) {
  return {
    id: messageId(n),
    metadata: { createdAt: at(n), sessionId: session },
    role: "user",
  };
}

function text(session: StoreId.Session, n: number, words: string) {
  return part(session, messageId(n), n * 10, { text: words, type: "text" });
}

/**
 * A chat with every kind of record: a settled title, star, archive, unread,
 * topics and a Stop on the chat's own session, a rollover; a task forked
 * from it, which the person stopped; user, assistant and context messages
 * with text, reasoning, data parts (one of a type no build reads) and tool
 * calls in every state; an image and a PDF a tool returned, the image twice;
 * and each thing a session is told. Its newest assistant message ends in a
 * call still waiting to run, which opening the chat finishes as interrupted.
 */
export function writeEveryKindChat(dir: string): Promise<ChatId> {
  return writeChat(dir, async (chat) => {
    const s = CHAT_SESSION;
    await saveSession(chat, {
      archivedAt: at(30),
      createdAt: at(0),
      id: s,
      rolledOverAfterMessageId: messageId(5),
      rolledOverUnderUsableTokens: 120_000,
      starredAt: at(20),
      stoppedAt: at(50),
      title: "Plans for the trip",
      titleSettledAt: at(10),
      topics: ["travel", "family"],
      unreadAt: at(40),
      unreadByUser: true,
      updatedAt: at(100),
    });
    await saveSession(chat, {
      createdAt: at(60),
      forkedAtMessageId: messageId(3),
      handle: "t1",
      id: TASK_SESSION,
      parentId: s,
      stoppedBy: "user",
      title: "Find hotels",
      updatedAt: at(90),
    });

    await saveMessage(chat, user(s, 1), [
      text(s, 1, "Help me plan a trip."),
      part(s, messageId(1), 11, {
        data: {
          files: [
            {
              filePath: "attachments/map.png",
              filename: "map.png",
              mimeType: "image/png",
              size: 12,
            },
          ],
          folders: [{ path: "/Users/someone/Trips" }],
        },
        type: "data-attachments",
      }),
    ]);
    await saveMessage(
      chat,
      {
        id: messageId(2),
        metadata: {
          agentName: "instrument",
          contextVersion: 3,
          createdAt: at(2),
          realRole: "system",
          sessionId: s,
        },
        role: "session-context",
      },
      [text(s, 2, "You are a helpful agent.")],
    );
    const m3 = messageId(3);
    const tool = (n: number, fields: Record<string, unknown>, ended = true) =>
      part(
        s,
        m3,
        n,
        { toolCallId: `call-${n}`, ...fields },
        {
          startedAt: at(n),
          ...(ended ? { endedAt: at(n + 1) } : {}),
        },
      );
    await saveMessage(chat, assistant(s, 3), [
      part(s, m3, 30, { type: "step-start" }, { stepCount: 1 }),
      part(
        s,
        m3,
        31,
        {
          providerMetadata: { anthropic: { signature: "sig" } },
          text: "Thinking about it.",
          type: "reasoning",
        },
        { endedAt: at(32) },
      ),
      part(s, m3, 32, { text: "Let me look.", type: "text" }),
      tool(
        33,
        {
          input: { command: "ls" },
          state: "input-streaming",
          type: "tool-bash",
        },
        false,
      ),
      tool(
        34,
        {
          input: { command: "pwd" },
          state: "input-available",
          type: "tool-bash",
        },
        false,
      ),
      tool(35, {
        input: { path: "map.png" },
        output: {
          base64Data: IMAGE.toString("base64"),
          filePath: "map.png",
          mimeType: "image/png",
          modifiedAt: 1,
          state: "image",
        },
        state: "output-available",
        type: "tool-read_file",
      }),
      tool(36, {
        input: { url: "https://example.com/guide.pdf" },
        output: {
          content: [
            { text: "The guide:", type: "text" },
            {
              base64Data: PDF.toString("base64"),
              mimeType: "application/pdf",
              type: "media",
            },
          ],
        },
        state: "output-available",
        type: "tool-web_fetch",
      }),
      tool(37, {
        errorText: "No such file",
        input: { path: "missing.txt" },
        state: "output-error",
        type: "tool-read_file",
      }),
      tool(38, {
        approval: { approved: true, id: "approval-1" },
        input: { command: "rm old.txt" },
        output: { exitCode: 0, stdout: "" },
        state: "output-available",
        type: "tool-bash",
      }),
    ]);
    await saveMessage(chat, user(s, 4), [
      text(s, 4, "Which one is cheaper?"),
      part(s, messageId(4), 41, {
        data: { messageId: m3, partId: partId(32), text: "Let me look." },
        type: "data-reply",
      }),
      part(s, messageId(4), 42, {
        data: {
          from: { modelId: "small-model" },
          to: { contextLength: 200_000, modelId: "big-model" },
        },
        type: "data-modelChange",
      }),
      part(s, messageId(4), 43, {
        data: { anything: "a part no build reads" },
        type: "data-retiredThing",
      }),
    ]);
    await saveMessage(chat, assistant(s, 5), [
      text(s, 5, "The second one."),
      part(s, messageId(5), 51, {
        data: { droppedMessages: 3, retainedUserMessages: 1 },
        type: "data-contextRollover",
      }),
    ]);
    await saveMessage(chat, assistant(s, 6), [
      part(
        s,
        messageId(6),
        60,
        {
          input: { command: "open booking.html" },
          state: "input-available",
          toolCallId: "call-60",
          type: "tool-bash",
        },
        { startedAt: at(60) },
      ),
    ]);

    await tell(chat, StorageKey.foldersBaseline(s), [
      { path: "/Users/someone/Trips" },
    ]);
    await tell(chat, StorageKey.chatAppsBaseline(s), {
      gmail: { connected: true, name: "Gmail" },
    });
    await tell(chat, StorageKey.memoryReported(s), { "trips.md": "rev-1" });
    await tell(chat, StorageKey.backgroundProcessesReported(s), [
      { command: "npm run dev", id: "bg_1" },
    ]);
    await tell(chat, StorageKey.browserState(s), {
      lastUsedAt: at(70),
      visitedHosts: ["example.com"],
    });

    const t = TASK_SESSION;
    await saveMessage(chat, user(t, 7), [text(t, 7, "Find three hotels.")]);
    await saveMessage(chat, assistant(t, 8), [
      part(
        t,
        messageId(8),
        80,
        {
          input: { path: "map.png" },
          output: {
            base64Data: IMAGE.toString("base64"),
            filePath: "map.png",
            mimeType: "image/png",
            modifiedAt: 1,
            state: "image",
          },
          state: "output-available",
          toolCallId: "call-80",
          type: "tool-read_file",
        },
        { endedAt: at(81), startedAt: at(80) },
      ),
      part(t, messageId(8), 85, { text: "Here are three.", type: "text" }),
    ]);
    await tell(chat, StorageKey.foldersBaseline(t), [
      { path: "/Users/someone/Trips" },
    ]);
  });
}

/** What the sweep writes over the call `writeEveryKindChat` left waiting. */
export const INTERRUPTED = {
  errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
  state: "output-error",
};

/** A chat whose title the app may still change, never updated since it began. */
export function writeUntitledChat(dir: string): Promise<ChatId> {
  return writeChat(dir, async (chat) => {
    const s = sessionId(10);
    await saveSession(chat, { createdAt: at(0), id: s, title: "New chat" });
    await saveMessage(chat, user(s, 11), [text(s, 11, "Hello there.")]);
  });
}
