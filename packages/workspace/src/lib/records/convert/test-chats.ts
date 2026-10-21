import fs from "node:fs/promises";
import path from "node:path";
import superjson from "superjson";

import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../../constants";
import { type ChatId } from "../../../schemas/chat-id";
import {
  type ChatDbSessionRow,
  type ChatDbStoredSessionRow,
} from "./read-chat-db";
import { SessionMessage } from "../../../schemas/session/message";
import { SessionMessagePart } from "../../../schemas/session/message-part";
import { SessionMessageRelaxedPart } from "../../../schemas/session/message-relaxed-part";
import { type StoreId } from "../../../schemas/store-id";
import { withChatDb } from "../../../test/helpers/chat-db";
import { createMockChatConfigForDir } from "../../../test/helpers/mock-chat-config";
import { StorageKey } from "../../storage-key";
import { STORE_MIGRATION_COUNT } from "../../store-migrations";
import { type WrappedStorage } from "../../wrap-storage";
import { at, messageId, partId, sessionId } from "../test-records";

/**
 * Chats in a `chat.db`, for the converter's tests: each one written as the
 * store wrote it, key by key, and closed again, as a chat was when an older
 * build quit. This is the only writer of that shape left; everything else
 * writes records.
 */

export const CHAT_SESSION = sessionId(1);
export const TASK_SESSION = sessionId(2);

/** The chat's own session row of `writeEveryKindChat`, for a test that writes it again. */
export const EVERY_KIND_SESSION: ChatDbSessionRow = {
  archivedAt: at(30),
  createdAt: at(0),
  id: CHAT_SESSION,
  rolledOverAfterMessageId: messageId(5),
  rolledOverUnderUsableTokens: 120_000,
  starredAt: at(20),
  stoppedAt: at(50),
  title: "Plans for the trip",
  titleSettledAt: at(10),
  topic: "travel",
  unreadAt: at(40),
  unreadByUser: true,
  updatedAt: at(100),
};

/** Bytes standing in for an image and a PDF a tool read. */
const IMAGE = Buffer.from("an image's bytes");
const PDF = Buffer.from("a PDF's bytes");

/**
 * Makes the chat whose record folder is `dir`, writing its `chat.db` with
 * `write` and closing it again. The database carries the migration version
 * the store wrote on every open, as one an older build left does.
 */
export async function writeChat(
  dir: string,
  write: (store: WrappedStorage) => Promise<void>,
): Promise<ChatId> {
  const chat = createMockChatConfigForDir(dir);
  await fs.mkdir(dir, { recursive: true });
  await withChatDb(path.join(dir, "chat.db"), async (store) => {
    (
      await store.setItemRaw("__migration_version__", STORE_MIGRATION_COUNT)
    )._unsafeUnwrap();
    await write(store);
  });
  return chat;
}

export async function saveSession(
  store: WrappedStorage,
  /** A task's `stoppedBy` in the words the store wrote it in. */
  session: ChatDbSessionRow | ChatDbStoredSessionRow,
): Promise<void> {
  await tell(store, StorageKey.session(session.id), session);
}

/** Saves a message with its parts, each part given as the store keeps it. */
export async function saveMessage(
  store: WrappedStorage,
  message: Record<string, unknown>,
  parts: SessionMessagePart.Type[] = [],
): Promise<void> {
  const saved = SessionMessage.Schema.parse(message);
  const session = saved.metadata.sessionId;
  await tell(store, StorageKey.message(session, saved.id), saved);
  for (const held of parts) {
    await tell(
      store,
      StorageKey.part(session, held.metadata.messageId, held.metadata.id),
      held,
    );
  }
}

/** A part numbered `n`, as the store reads one back. */
export function part(
  session: StoreId.Session,
  message: StoreId.Message,
  n: number,
  fields: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): SessionMessagePart.Type {
  return SessionMessagePart.coerce(row(session, message, n, fields, metadata));
}

/**
 * A part numbered `n` as the store keeps one, which reading it does not give
 * back: a payload of a type no schema here has, one written before a field
 * its schema now describes, or a failed call's `rawInput`. Typed as a part
 * because that is what the store takes, and nothing here describes a payload
 * whose shape has retired.
 */
function storedPart(
  session: StoreId.Session,
  message: StoreId.Message,
  n: number,
  fields: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): SessionMessagePart.Type {
  return row(session, message, n, fields, metadata) as SessionMessagePart.Type;
}

/** The row a part is stored as, through the schema the store writes with. */
function row(
  session: StoreId.Session,
  message: StoreId.Message,
  n: number,
  fields: Record<string, unknown>,
  metadata: Record<string, unknown>,
): SessionMessageRelaxedPart.Type {
  return SessionMessageRelaxedPart.Schema.parse({
    ...fields,
    metadata: {
      createdAt: at(n),
      id: partId(n),
      messageId: message,
      sessionId: session,
      ...metadata,
    },
  });
}

/** Stores a session's standing facts, as each fact's module stores them. */
export async function tell(
  store: WrappedStorage,
  key: string,
  value: unknown,
): Promise<void> {
  (await store.setItemRaw(key, superjson.stringify(value)))._unsafeUnwrap();
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
 * topic and a Stop on the chat's own session, a rollover; a task forked
 * from it, which the person stopped; user, assistant and context messages
 * with text, reasoning, data parts (one of a type no build reads) and tool
 * calls in every state; an image and a PDF a tool returned, the image twice;
 * and each standing fact a session holds. Its newest assistant message ends in a
 * call still waiting to run, which opening the chat finishes as interrupted.
 */
export function writeEveryKindChat(dir: string): Promise<ChatId> {
  return writeChat(dir, async (store) => {
    const s = CHAT_SESSION;
    await saveSession(store, EVERY_KIND_SESSION);
    await saveSession(store, {
      createdAt: at(60),
      forkedAtMessageId: messageId(3),
      handle: "t1",
      id: TASK_SESSION,
      parentId: s,
      stoppedBy: "user",
      title: "Find hotels",
      updatedAt: at(90),
    });

    await saveMessage(store, user(s, 1), [
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
      store,
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
    await saveMessage(store, assistant(s, 3), [
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
    await saveMessage(store, user(s, 4), [
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
    await saveMessage(store, assistant(s, 5), [
      text(s, 5, "The second one."),
      part(s, messageId(5), 51, {
        data: { droppedMessages: 3, retainedUserMessages: 1 },
        type: "data-contextRollover",
      }),
    ]);
    await saveMessage(store, assistant(s, 6), [
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

    await tell(store, StorageKey.foldersBaseline(s), [
      { path: "/Users/someone/Trips" },
    ]);
    await tell(store, StorageKey.chatAppsBaseline(s), {
      gmail: { connected: true, name: "Gmail" },
    });
    await tell(store, StorageKey.memoryReported(s), { "trips.md": "rev-1" });
    await tell(store, StorageKey.backgroundProcessesReported(s), [
      { command: "npm run dev", id: "bg_1" },
    ]);
    await tell(store, StorageKey.browserState(s), {
      lastUsedAt: at(70),
      visitedHosts: ["example.com"],
    });

    const t = TASK_SESSION;
    await saveMessage(store, user(t, 7), [text(t, 7, "Find three hotels.")]);
    await saveMessage(store, assistant(t, 8), [
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
    await tell(store, StorageKey.foldersBaseline(t), [
      { path: "/Users/someone/Trips" },
    ]);
  });
}

/** What the sweep writes over the call `writeEveryKindChat` left waiting. */
export const INTERRUPTED = {
  errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
  state: "output-error",
};

/** The session of `writeOlderThanSchemasChat`. */
export const OLDER_SESSION = sessionId(20);

/**
 * A chat older than the schemas that read it: a data part of a type no
 * schema here has, one whose payload was written before a field its schema
 * now describes, and a call whose row kept the model's input in `rawInput`
 * beside the file in its output. Reading any of the three gives back less
 * than the row holds.
 */
export function writeOlderThanSchemasChat(dir: string): Promise<ChatId> {
  return writeChat(dir, async (store) => {
    const s = OLDER_SESSION;
    await saveSession(store, {
      createdAt: at(0),
      id: s,
      title: "What the task did",
      titleSettledAt: at(1),
      updatedAt: at(25),
    });
    await saveMessage(store, user(s, 21), [text(s, 21, "What did it do?")]);
    await saveMessage(store, assistant(s, 22), [
      storedPart(s, messageId(22), 220, {
        data: { handle: "t1", title: "Find hotels" },
        type: "data-adoptedTask",
      }),
      storedPart(s, messageId(22), 221, {
        // Written before an event named the task's session, which its
        // schema now asks for.
        data: {
          events: [
            { status: "done", summary: "Three hotels", title: "Find hotels" },
          ],
        },
        type: "data-taskEvent",
      }),
      storedPart(
        s,
        messageId(22),
        222,
        {
          input: { path: "map.png" },
          output: {
            base64Data: IMAGE.toString("base64"),
            filePath: "map.png",
            mimeType: "image/png",
            modifiedAt: 1,
            state: "image",
          },
          rawInput: { filePath: "map.png" },
          state: "output-available",
          toolCallId: "call-222",
          type: "tool-read_file",
        },
        { endedAt: at(23), startedAt: at(22) },
      ),
    ]);
  });
}

/** A chat whose title the app may still change, never updated since it began. */
export function writeUntitledChat(dir: string): Promise<ChatId> {
  return writeChat(dir, async (store) => {
    const s = sessionId(10);
    await saveSession(store, { createdAt: at(0), id: s, title: "New chat" });
    await saveMessage(store, user(s, 11), [text(s, 11, "Hello there.")]);
  });
}
