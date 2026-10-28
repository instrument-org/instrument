import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import {
  AbsolutePathSchema,
  RelativePathSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { APP_FILE_NAME } from "../apps/app-file";
import { chatRecords } from "../records/chat-records";
import { recordAsk } from "./asks";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { recordChanged, recordRemoved } from "../record-changes";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { chatDir, forgetChat, sessionOfChat } from "../record-folders";
import { chatGone } from "../chat-gone";
import {
  startRecordArrivals,
  stopRecordArrivals,
} from "../records/take-arrivals";
import { listChatIds } from "./chat-records";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type ChatActivity } from "./activity";
import {
  archiveChat,
  type Chat,
  listChats,
  markChatRead,
  markChatStopped,
  markChatUnread,
  startChatUnreadOnSettle,
  renameChat,
  setChatStarred,
  setChatTopic,
  settleChatTitle,
  unarchiveChat,
} from "./chats";
import { updateSessionTitle } from "../update-session-title";
import { chatRowAsked, liveChatList } from "./live-chat-list";
import { CHAT_LIST_FILE_NAME, startChatListFile } from "./chat-list-file";
import { workspaceLayout } from "../workspace-layout";
import { createTopic } from "./topics";

const running = vi.hoisted(() => {
  const value: ChatActivity["running"] = [];
  return { value };
});
const alive = vi.hoisted(() => ({ value: new Set<string>() }));
const pendingWakes = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock(import("./wake-queue"), async (importOriginal) => ({
  ...(await importOriginal()),
  hasWakeOnItsWay: (chatId: string) => pendingWakes.value.has(chatId),
}));

// What the machine would say: which tasks are at work, and which sessions
// have a live agent. Neither exists in a test, so both are dials.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: (chatId: ChatId) =>
    Promise.resolve({
      running: running.value.filter(
        (task) => task.chat === sessionOfChat(chatId),
      ),
    }),
}));
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: {
          sessionRefsByChatId: {
            get: () =>
              [...alive.value].map((sessionId) => ({
                getSnapshot: () => ({
                  context: { sessionId },
                  tags: new Set(["agent.alive"]),
                }),
              })),
          },
        },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

// Task state and sessions are real files under the mock workspace, so a task
// id reused across runs would read the last run's chats.
let counter = 0;
/** Every root a case made, removed after it. */
const roots: string[] = [];
/**
 * A workspace of its own: chats, topics and the window's state all live
 * under the root, so each test gets one.
 */
const freshChat = async () => {
  const chatId = createMockChatConfig(
    ChatIdSchema.parse(`chats-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chats-root-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
  });
  return chatId;
};

/** A task started in a chat: a session of that chat's. */
async function fileTask(sessionId: StoreId.Session, title = "Grocery list") {
  return chatTaskFor(await chatFor(sessionId), { title });
}

beforeEach(() => {
  running.value = [];
  alive.value = new Set();
  pendingWakes.value = new Set();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

/** A reply that asked the user with `choose`, and the question it left open. */
async function agentAsks(_chatId: ChatId, sessionId: StoreId.Session) {
  const messageId = StoreId.newMessageId();
  const part = {
    input: { choices: ["Yes", "No"], question: "Which one?" },
    metadata: {
      ...partMetadata({ messageId, sessionId }),
      createdAt: at(5),
      endedAt: at(5),
    },
    output: { asked: true as const },
    state: "output-available" as const,
    toolCallId: "call_choose",
    type: "tool-choose" as const,
  };
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at(5),
      finishedAt: at(5),
      finishReason: "stop",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [part],
    role: "assistant",
  };
  const saved = await ChatWrites.saveMessageWithParts(
    message,
    await chatFor(sessionId),
  );
  expect(saved.isOk()).toBe(true);
}

/** A finished reply, with words and whatever tool calls it made. */
async function agentSays(
  _chatId: ChatId,
  sessionId: StoreId.Session,
  text: string,
  {
    commands = [],
    error,
    failed = false,
    finished = true,
    minute = 0,
  }: {
    commands?: string[];
    /** The error the step ended in, when it ended in one. */
    error?: SessionMessage.Assistant["metadata"]["error"];
    /** Whether the step ended in an error rather than its stop. */
    failed?: boolean;
    finished?: boolean;
    minute?: number;
  } = {},
) {
  const messageId = StoreId.newMessageId();
  const ids = { messageId, sessionId };
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at(minute),
      ...(error && { error }),
      finishReason: failed || error ? "error" : "stop",
      ...(finished ? { finishedAt: at(minute) } : {}),
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      ...commands.map((command) => ({
        input: { command, explanation: "Running a command", yieldMs: 1000 },
        metadata: { ...partMetadata(ids), endedAt: new Date() },
        output: {
          command,
          commands: [command],
          durationMs: 0,
          exitCode: 0,
          omittedBytes: 0,
          output: "",
        },
        state: "output-available" as const,
        toolCallId: `call_${StoreId.newPartId()}`,
        type: "tool-bash" as const,
      })),
      ...(text
        ? [{ metadata: partMetadata(ids), text, type: "text" as const }]
        : []),
    ],
    role: "assistant",
  };
  const saved = await ChatWrites.saveMessageWithParts(
    message,
    await chatFor(sessionId),
  );
  expect(saved.isOk()).toBe(true);
  return messageId;
}

/** A note the app writes as a user message, which the user never typed. */
async function noteSays(
  sessionId: StoreId.Session,
  minute: number,
  part: (
    metadata: ReturnType<typeof partMetadata>,
  ) => SessionMessage.UserWithParts["parts"][number],
) {
  const messageId = StoreId.newMessageId();
  const saved = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: { createdAt: at(minute), sessionId },
      parts: [part(partMetadata({ messageId, sessionId }))],
      role: "user",
    },
    await chatFor(sessionId),
  );
  expect(saved.isOk()).toBe(true);
}

function partMetadata(ids: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return { createdAt: new Date(), id: StoreId.newPartId(), ...ids };
}

/** A chat: a chat's folder and its one session. */
async function session(_chatId: ChatId, title: string, minute = 0) {
  const id = StoreId.newSessionId();
  const chatId = await chatFor(id, undefined, { createdAt: at(minute) });
  await ChatWrites.saveSession(
    { createdAt: at(minute), id, title, updatedAt: at(minute) },
    chatId,
  );
  return id;
}

async function userSays(
  _chatId: ChatId,
  sessionId: StoreId.Session,
  text: string,
  minute = 0,
  sent: {
    attachments?: string[];
    viewing?: SessionMessageDataPart.ViewContextDataPart;
  } = {},
) {
  const messageId = StoreId.newMessageId();
  const parts: SessionMessage.UserWithParts["parts"] = [
    { metadata: partMetadata({ messageId, sessionId }), text, type: "text" },
  ];
  if (sent.viewing) {
    parts.push({
      data: sent.viewing,
      metadata: partMetadata({ messageId, sessionId }),
      type: "data-viewContext",
    });
  }
  if (sent.attachments) {
    parts.push({
      data: {
        files: sent.attachments.map((filePath) => ({
          filename: path.basename(filePath),
          filePath: RelativePathSchema.parse(filePath),
          mimeType: "application/octet-stream",
          modifiedAt: 0,
          size: 1,
        })),
      },
      metadata: partMetadata({ messageId, sessionId }),
      type: "data-attachments",
    });
  }
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt: at(minute), sessionId },
    parts,
    role: "user",
  };
  const saved = await ChatWrites.saveMessageWithParts(
    message,
    await chatFor(sessionId),
  );
  expect(saved.isOk()).toBe(true);
  return messageId;
}

describe("listChats", () => {
  it("keeps the user's timestamp through replies and harness notifications", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(0).getTime());
    await userSays(chatId, sessionId, "make a list", 1);
    await agentSays(chatId, sessionId, "Checking the pantry", { minute: 2 });
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(1).getTime());

    const messageId = StoreId.newMessageId();
    const saved = await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        role: "user",
        metadata: { createdAt: at(3), sessionId },
        parts: [
          {
            type: "data-taskEvent",
            data: {
              events: [
                {
                  sessionId: StoreId.newSessionId(),
                  status: "done",
                  title: "Check the pantry",
                },
              ],
            },
            metadata: partMetadata({ messageId, sessionId }),
          },
        ],
      },
      await chatFor(sessionId),
    );
    expect(saved.isOk()).toBe(true);
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(1).getTime());

    await userSays(chatId, sessionId, "", 4, { attachments: ["pantry.txt"] });
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(4).getTime());
    await userSays(chatId, sessionId, "include milk", 5);
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(5).getTime());

    const asksId = StoreId.newMessageId();
    const asked = await ChatWrites.saveMessageWithParts(
      {
        id: asksId,
        role: "user",
        metadata: { createdAt: at(6), sessionId },
        parts: [
          {
            type: "data-asks",
            data: {
              asks: [
                {
                  file: { name: "list.md", path: "list.md" },
                  instruction: "add eggs",
                  target: "line 3",
                },
              ],
            },
            metadata: partMetadata({ messageId: asksId, sessionId }),
          },
        ],
      },
      await chatFor(sessionId),
    );
    expect(asked.isOk()).toBe(true);
    expect((await listChats())[0]?.lastUserMessageAt).toBe(at(6).getTime());
  });

  it("lists the chats oldest first, with their roots, counts and latest lines", async () => {
    const chatId = await freshChat();
    const groceries = await session(chatId, "Groceries for the week", 1);
    await userSays(chatId, groceries, "make me a grocery list", 1);
    await agentSays(chatId, groceries, "Starting the list.\nMore below.", {
      minute: 2,
    });
    await agentSays(chatId, groceries, "", { minute: 3 });
    const trip = await session(chatId, "Trip to Lisbon", 4);
    await userSays(chatId, trip, "plan a trip to lisbon", 4);

    const chats = await listChats();

    expect(
      chats.map((chat) => ({
        createdAt: chat.createdAt,
        latest: chat.latest,
        root: chat.root?.parts.find((part) => part.type === "text")?.text,
        state: chat.state,
        title: chat.title,
        unread: chat.unread,
      })),
    ).toEqual([
      {
        createdAt: at(1).getTime(),
        latest: {
          at: at(2).getTime(),
          kind: "reply",
          text: "Starting the list.",
        },
        root: "make me a grocery list",
        state: "idle",
        title: "Groceries for the week",
        unread: false,
      },
      {
        createdAt: at(4).getTime(),
        latest: undefined,
        root: "plan a trip to lisbon",
        state: "idle",
        title: "Trip to Lisbon",
        unread: false,
      },
    ]);
  });

  it("lets the ask stand for a chat the agent has not named yet", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Untitled chat 3");
    await userSays(chatId, sessionId, "plan a trip to lisbon\nin october", 1);

    const [chat] = await listChats();
    expect(chat?.title).toBe("plan a trip to lisbon");
  });

  it("holds a long ask standing for the title to a title's length", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Untitled chat 5");
    await userSays(
      chatId,
      sessionId,
      "plan a trip to lisbon in october with a day in sintra and a night of fado",
      1,
    );

    const [chat] = await listChats();
    expect(chat?.title).toBe("plan a trip to lisbon in october with…");
  });

  it("lists a chat whose first message has not been saved yet", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Untitled chat 4", 2);

    const [chat] = await listChats();
    expect(chat?.sessionId).toBe(sessionId);
    expect(chat?.createdAt).toBe(at(2).getTime());
  });

  it("lists a chat started with only an ask marked on a file", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Make page 1 red");
    const messageId = StoreId.newMessageId();
    const file = { name: "digest.docx", path: "/Users/me/digest.docx" };
    const saved = await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: { createdAt: at(1), sessionId },
        parts: [
          {
            data: {
              asks: [
                {
                  excerpt: "Digest",
                  file,
                  instruction: "make this red",
                  target: "page 1",
                },
              ],
            },
            metadata: partMetadata({ messageId, sessionId }),
            type: "data-asks",
          },
        ],
        role: "user",
      },
      await chatFor(sessionId),
    );
    expect(saved.isOk()).toBe(true);

    const [chat] = await listChats();
    expect(chat?.sessionId).toBe(sessionId);
  });

  it("reads what was said since the last list, and a part rewritten in place", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const [asked] = await listChats();
    expect(asked?.latest).toBeUndefined();

    await agentSays(chatId, sessionId, "Here is the list.", { minute: 2 });
    const [replied] = await listChats();
    expect(replied?.latest?.text).toBe("Here is the list.");

    const read = await ChatReads.transcript({
      sessionId,
      chatId: await chatFor(sessionId),
    });
    const reply = read
      ._unsafeUnwrap()
      .find((message) => message.role === "assistant");
    const part = reply?.parts.find((entry) => entry.type === "text");
    if (!part) {
      throw new Error("no reply text");
    }
    await ChatWrites.savePart(
      { ...part, text: "Here is the new list." },
      await chatFor(sessionId),
    );
    const [rewritten] = await listChats();
    expect(rewritten?.latest?.text).toBe("Here is the new list.");
  });

  it("marks any chat unread and read again, whatever it holds", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);

    await markChatUnread(await chatFor(sessionId), { byUser: true });
    const [marked] = await listChats();
    expect(marked).toMatchObject({ unread: true, unreadByUser: true });

    await markChatRead(await chatFor(sessionId));
    const [read] = await listChats();
    expect(read).toMatchObject({ unread: false, unreadByUser: false });
  });

  it("marks a chat unread once it settles, and not while something of it still works", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const child = StoreId.newSessionId();
    running.value = [
      {
        chat: sessionId,
        sessionId: child,
        title: "Bake",
        updatedAt: Date.now(),
      },
    ];
    startChatUnreadOnSettle();

    publisher.publish("session.done", {
      id: await chatFor(sessionId),
      sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [working] = await listChats();
    expect(working?.unread).toBe(false);

    running.value = [];
    publisher.publish("session.done", {
      id: await chatFor(sessionId),
      sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [settled] = await listChats();
    expect(settled).toMatchObject({ unread: true, unreadByUser: false });
  });

  it("leaves a chat read when its turn ends with a wake on its way", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    pendingWakes.value.add(await chatFor(sessionId));
    startChatUnreadOnSettle();

    publisher.publish("session.done", {
      id: await chatFor(sessionId),
      sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    pendingWakes.value.clear();
    const [waking] = await listChats();
    expect(waking?.unread).toBe(false);
  });

  it("leaves a chat read when the person stopped its turn", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    startChatUnreadOnSettle();

    publisher.publish("session.done", {
      id: await chatFor(sessionId),
      notice: { by: "person", wakesChat: false },
      sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [stopped] = await listChats();
    expect(stopped?.unread).toBe(false);
  });

  it("keeps a mark the user set theirs when the chat settles under it", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);

    await markChatUnread(await chatFor(sessionId), { byUser: true });
    await markChatUnread(await chatFor(sessionId), { byUser: false });
    const [chat] = await listChats();
    expect(chat).toMatchObject({ unread: true, unreadByUser: true });
  });

  it("says a chat failed while its last turn ended in an error, until it answers", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", { failed: true, minute: 2 });
    const [failed] = await listChats();
    expect(failed?.state).toBe("failed");

    await agentSays(chatId, sessionId, "Doing well!", { minute: 3 });
    const [answered] = await listChats();
    expect(answered?.state).toBe("idle");
  });

  it("says a chat stopped at a usage limit is limited, not failed", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", {
      error: {
        classification: "usage-limit",
        kind: "unknown",
        message: "Usage limit reached.",
      },
      minute: 2,
    });

    const [chat] = await listChats();
    expect(chat?.state).toBe("limited");
    expect(chat?.stoppedFor).toBe("usage");
  });

  it("says a chat Instrument refused for want of a plan stopped for its plan", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", {
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message: "Start your free trial or choose a plan.",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: { code: "subscription-required", reason: "trial-available" },
        }),
        statusCode: 402,
        url: "http://127.0.0.1/ai-gateway/providers/instrument/chat/completions",
      },
      minute: 2,
    });

    const [chat] = await listChats();
    expect(chat).toMatchObject({ state: "limited", stoppedFor: "plan" });
  });

  it("says a chat Instrument refused for a failed payment stopped for its payment", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", {
      error: {
        classification: "usage-limit",
        kind: "api-call",
        message: "Your last payment did not go through.",
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: { code: "subscription-required", reason: "payment-failed" },
        }),
        statusCode: 402,
        url: "http://127.0.0.1/ai-gateway/providers/instrument/chat/completions",
      },
      minute: 2,
    });

    const [chat] = await listChats();
    expect(chat).toMatchObject({ state: "limited", stoppedFor: "payment" });
  });

  it("leaves a failed turn behind once the user sends again", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", { failed: true, minute: 2 });
    await userSays(chatId, sessionId, "hello?", 3);

    const [chat] = await listChats();
    expect(chat?.state).not.toBe("failed");
  });

  // A reply cut off by its request timing out never got out, which nobody
  // asked for; one cut off by a stop someone asked for is no error, and nor
  // is one cut off before the reason was kept.
  it.each([
    { reason: "timeout", state: "failed" },
    { reason: "manual", state: "idle" },
    { reason: undefined, state: "idle" },
  ] as const)(
    "reads a reply cut off for $reason as $state",
    async ({ reason, state }) => {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Documents", 1);
      await userSays(chatId, sessionId, "what's in my Documents?", 1);
      const replyId = StoreId.newMessageId();
      const reply = await ChatWrites.saveMessageWithParts(
        {
          id: replyId,
          metadata: {
            createdAt: at(2),
            error: {
              kind: "aborted",
              message: "Aborted",
              ...(reason ? { reason } : {}),
            },
            finishReason: "aborted",
            finishedAt: at(2),
            modelId: "glm-5.3-flash",
            providerId: "openai-compatible",
            sessionId,
          },
          parts: [],
          role: "assistant",
        },
        await chatFor(sessionId),
      );
      expect(reply.isOk()).toBe(true);

      const [chat] = await listChats();
      expect(chat?.state).toBe(state);
    },
  );

  it("carries the topic a chat is filed under, and files it under none for an id that is not one", async () => {
    const chatId = await freshChat();
    const home = await createTopic({ name: "Home" });
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list");
    const id = await chatFor(sessionId);

    await setChatTopic(id, home.id);
    expect((await listChats())[0]?.topic).toBe(home.id);

    await setChatTopic(id, "top_nothing");
    expect((await listChats())[0]?.topic).toBeUndefined();
  });

  it("puts a chat away and brings it back, without moving its stamp", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();
    expect(before?.archived).toBe(false);

    await archiveChat(await chatFor(sessionId));
    const [archived] = await listChats();
    expect(archived?.archived).toBe(true);
    expect(archived?.updatedAt).toBe(before?.updatedAt);

    await unarchiveChat(await chatFor(sessionId));
    const [back] = await listChats();
    expect(back?.archived).toBe(false);
  });

  it("stars a chat and takes the star off, without moving its stamp", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();
    expect(before?.starred).toBe(false);

    await setChatStarred(await chatFor(sessionId), true);
    const [starred] = await listChats();
    expect(starred?.starred).toBe(true);
    expect(starred?.updatedAt).toBe(before?.updatedAt);

    await setChatStarred(await chatFor(sessionId), false);
    const [back] = await listChats();
    expect(back?.starred).toBe(false);
  });

  it("takes the name the user typed, without moving its stamp", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();

    await renameChat(await chatFor(sessionId), "Weekly shop");
    const [renamed] = await listChats();
    expect(renamed?.title).toBe("Weekly shop");
    expect(renamed?.updatedAt).toBe(before?.updatedAt);
    const stored = await ChatReads.session({
      chatId: await chatFor(sessionId),
      sessionId,
    });
    expect(stored._unsafeUnwrap().titleSettledAt).toBeInstanceOf(Date);
  });

  it("tells the name the app gave from the one the user typed", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Untitled chat", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const id = await chatFor(sessionId);

    await updateSessionTitle({ chatId: id, sessionId, title: "Grocery list" });
    await settleChatTitle(id);
    const [named] = await listChats();
    expect([named?.title, named?.titleByApp]).toEqual(["Grocery list", true]);

    await renameChat(id, "Weekly shop");
    const [renamed] = await listChats();
    expect([renamed?.title, renamed?.titleByApp]).toEqual([
      "Weekly shop",
      false,
    ]);
  });

  it("cuts a typed name to the length its folder is named under", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);

    await renameChat(
      await chatFor(sessionId),
      "A very long name for a grocery list that runs on and on past what a folder name may hold",
    );
    const [renamed] = await listChats();
    expect(renamed?.title).toBe(
      "A very long name for a grocery list that runs on and on past what a folder name",
    );
  });

  it("is working while a task filed from it runs, and says its step", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
    const child = await fileTask(sessionId);
    running.value = [
      {
        chat: sessionId,
        step: "Checking the pantry",
        sessionId: child,
        title: "Grocery list",
        updatedAt: at(3).getTime(),
      },
    ];

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
    expect(chat?.latest).toEqual({
      at: at(2).getTime(),
      kind: "step",
      text: "Checking the pantry",
    });
    expect(chat?.runningTasks).toEqual([
      { id: child, step: "Checking the pantry", title: "Grocery list" },
    ]);
  });

  it("is working while its own agent is alive, saying what it is doing", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "", {
      commands: ["task list"],
      minute: 2,
    });
    alive.value = new Set([sessionId]);

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
    expect(chat?.latest?.kind).toBe("step");
    expect(chat?.latest?.text).toBe("Running a command");
  });

  // A message reaches its session as it is written, and the turn it starts
  // is the session's from then until it ends. How new the message is says
  // nothing: one no turn took up, as a Stop before it began leaves, is not
  // work.
  it("works while its session has a turn, however old its message, and not on a message none took up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Groceries", 1);
      await userSays(chatId, sessionId, "make me a grocery list", 1);
      await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
      await userSays(chatId, sessionId, "add eggs", 3);
      vi.setSystemTime(at(3).getTime() + 5000);

      const [untaken] = await listChats();
      expect(untaken?.state).toBe("idle");

      vi.setSystemTime(at(3).getTime() + 60_000);
      alive.value = new Set([sessionId]);
      const [taken] = await listChats();
      expect(taken?.state).toBe("working");
    } finally {
      vi.useRealTimers();
    }
  });

  // A note a stop leaves is written into the chat while its own turn may
  // still be going, and starts nothing: the turn's step is still its step.
  it("names its turn's step past a note a stopped task leaves mid-turn", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Counts", 1);
    await userSays(chatId, sessionId, "count to a million", 1);
    await agentSays(chatId, sessionId, "", {
      commands: ["task list"],
      finished: false,
      minute: 2,
    });
    await noteSays(sessionId, 3, (metadata) => ({
      data: {
        events: [
          {
            ended: "Stopped while counting",
            handle: "t1",
            sessionId: StoreId.newSessionId(),
            status: "done",
            stoppedBy: "person",
            title: "Count the lines",
          },
        ],
      },
      metadata,
      type: "data-taskEvent",
    }));
    alive.value = new Set([sessionId]);

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
    expect(chat?.latest).toMatchObject({
      kind: "step",
      text: "Running a command",
    });
  });

  it("is working while a task filed from it has finished and its wake waits to be written", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
    await fileTask(sessionId);
    pendingWakes.value = new Set([await chatFor(sessionId)]);

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
  });

  it("is waiting on the question its last turn asked", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentAsks(chatId, sessionId);

    const [chat] = await listChats();

    expect(chat?.state).toBe("waiting");
    expect(chat?.latest).toEqual({
      at: at(5).getTime(),
      kind: "question",
      text: "Which one?",
    });
  });

  it("waits on an open card, even while the turn that raised it winds down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Pantry");
      await userSays(chatId, sessionId, "read my pantry list", 1);
      await agentSays(chatId, sessionId, "", {
        commands: ["cat ~/Pantry/list.txt"],
        finished: false,
        minute: 2,
      });
      vi.setSystemTime(at(3));
      await recordAsk(
        { chatId: await chatFor(sessionId), sessionId },
        "folder",
        path.join(os.homedir(), "Pantry"),
      );
      alive.value = new Set([sessionId]);

      const [winding] = await listChats();
      expect(winding?.state).toBe("waiting");
      expect(winding?.latest).toEqual({
        at: at(3).getTime(),
        kind: "question",
        text: "Waiting for your OK to use “Pantry”",
      });

      alive.value = new Set();
      const [ended] = await listChats();
      expect(ended?.state).toBe("waiting");

      // The user sent something else rather than answer: the turn that
      // starts is what the chat is on until it ends.
      await userSays(chatId, sessionId, "never mind, check the fridge", 4);
      alive.value = new Set([sessionId]);
      const [spokenPast] = await listChats();
      expect(spokenPast?.state).toBe("working");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idle after a relaunch past the note the quit left, and waits only on a card still open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Groceries", 1);
      await userSays(chatId, sessionId, "make me a grocery list", 1);
      await agentSays(chatId, sessionId, "A task is on it.", {
        commands: ["instrument task new 'Count the lines'"],
        minute: 2,
      });
      await noteSays(sessionId, 3, (metadata) => ({
        data: {
          events: [
            {
              ended: "The app closed while counting",
              handle: "t1",
              sessionId: StoreId.newSessionId(),
              status: "done",
              stoppedBy: "app",
              title: "Count the lines",
            },
          ],
        },
        metadata,
        type: "data-taskEvent",
      }));

      vi.setSystemTime(at(3).getTime() + 5000);
      const [relaunched] = await listChats();
      expect(relaunched?.state).toBe("idle");
      // What the line says "Done" by once the chat is at rest.
      expect(relaunched?.lastStep?.at).toBe(at(2).getTime());

      // A card raised before the quit still waits on the user: the note is
      // not the user speaking past it.
      vi.setSystemTime(at(2).getTime() + 30_000);
      await recordAsk(
        { chatId: await chatFor(sessionId), sessionId },
        "folder",
        path.join(os.homedir(), "Pantry"),
      );
      vi.setSystemTime(at(3).getTime() + 5000);
      const [carded] = await listChats();
      expect(carded?.state).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("works while a background job's wake is on its way and through the turn it starts, then settles", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Documents", 1);
    await userSays(chatId, sessionId, "what's in my Documents folder?", 1);
    await agentSays(chatId, sessionId, "Still listing it.", {
      commands: ["ls ~/Documents"],
      minute: 2,
    });
    await noteSays(sessionId, 3, (metadata) => ({
      data: {
        events: [
          {
            command: "ls ~/Documents",
            durationMs: 40_000,
            exitCode: 0,
            id: "bg_1",
            logFilePath: ".instrument/processes/bg_1.log",
            status: "exited",
          },
        ],
      },
      metadata,
      type: "data-jobEvent",
    }));

    // Written, and on its way to the session.
    pendingWakes.value = new Set([await chatFor(sessionId)]);
    const [woken] = await listChats();
    expect(woken?.state).toBe("working");

    pendingWakes.value = new Set();
    alive.value = new Set([sessionId]);
    const [answering] = await listChats();
    expect(answering?.state).toBe("working");

    await agentSays(chatId, sessionId, "Your Documents folder holds Taxes.", {
      minute: 4,
    });
    alive.value = new Set();
    const [settled] = await listChats();
    expect(settled?.state).toBe("idle");
  });

  // The person's Stop is what says so, however the turn ended: before it
  // began, as here, with the message no turn took up; mid-call; or
  // mid-reply. A note a task's stop leaves starts no turn, so it is not
  // something happening after the Stop.
  it("says the person stopped its turn from their Stop until a turn starts after it", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Documents", 1);
    await userSays(chatId, sessionId, "what's in my Documents?", 1);
    await markChatStopped(await chatFor(sessionId), at(2));

    const [beforeStart] = await listChats();
    expect(beforeStart?.state).toBe("stopped");

    await noteSays(sessionId, 3, (metadata) => ({
      data: {
        events: [
          {
            ended: "Stopped while waiting",
            handle: "t1",
            sessionId: StoreId.newSessionId(),
            status: "done",
            stoppedBy: "person",
            title: "Sleep 150 seconds",
          },
        ],
      },
      metadata,
      type: "data-taskEvent",
    }));
    const [pastNote] = await listChats();
    expect(pastNote?.state).toBe("stopped");

    // The next turn starting is what ends it.
    await userSays(chatId, sessionId, "try Desktop instead", 4);
    alive.value = new Set([sessionId]);
    const [next] = await listChats();
    expect(next?.state).toBe("working");

    // A reply cut off with no Stop of the person's behind it is not theirs.
    alive.value = new Set();
    const replyId = StoreId.newMessageId();
    const reply = await ChatWrites.saveMessageWithParts(
      {
        id: replyId,
        metadata: {
          createdAt: at(5),
          error: { kind: "aborted", message: "Aborted" },
          finishReason: "aborted",
          finishedAt: at(5),
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId,
        },
        parts: [
          {
            metadata: partMetadata({ messageId: replyId, sessionId }),
            text: "Your Desktop holds",
            type: "text",
          },
        ],
        role: "assistant",
      },
      await chatFor(sessionId),
    );
    expect(reply.isOk()).toBe(true);
    const [cutOff] = await listChats();
    expect(cutOff?.state).not.toBe("stopped");
  });

  it("reads a reply that is only the files it handed over by what it wrote", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Compare");
    await userSays(chatId, sessionId, "compare the two quotes", 1);
    await agentSays(
      chatId,
      sessionId,
      "```files\n/Users/sam/Instrument/quotes/compared.html\n```",
      { minute: 2 },
    );

    const [chat] = await listChats();
    expect(chat?.latest).toEqual({
      at: at(2).getTime(),
      kind: "reply",
      text: "Wrote compared.html",
    });

    await agentSays(
      chatId,
      sessionId,
      "```files\n/Users/sam/Instrument/quotes/a.md\n/Users/sam/Instrument/quotes/b.png\n/Users/sam/Instrument/quotes/c.html\n```",
      { minute: 3 },
    );
    const [updated] = await listChats();
    expect(updated?.latest?.text).toBe("Wrote 3 files: a.md, b.png, c.html");
  });

  it("reads what the chat made and used out of its replies", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(
      chatId,
      sessionId,
      "Here it is.\n\n```files\n/Users/sam/Instrument/groceries/list.md\n```",
      {
        commands: [
          'instrument app call notion search \'{"query":"groceries"}\'',
          "instrument window show https://www.instacart.com/store",
        ],
        minute: 2,
      },
    );
    // One `show` opening two pages.
    await agentSays(
      chatId,
      sessionId,
      "Updated.\n\n```files\n/Users/sam/Instrument/groceries/list.md\n/Users/sam/Instrument/groceries/prices.csv\n```",
      {
        commands: [
          "instrument window show https://www.costco.com/ 'https://www.target.com/'",
        ],
        minute: 3,
      },
    );

    const [chat] = await listChats();

    expect(chat?.holds).toEqual({
      apps: ["notion"],
      files: [
        "/Users/sam/Instrument/groceries/list.md",
        "/Users/sam/Instrument/groceries/prices.csv",
      ],
      sites: ["www.instacart.com", "www.costco.com", "www.target.com"],
    });
  });

  it("holds what was selected in a folder the user sent from, in place of the folder", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Recipes");
    await userSays(chatId, sessionId, "tidy these", 1, {
      viewing: {
        folder: {
          display: "~/Recipes",
          mount: "/Users/sam/Recipes",
          selected: ["soup.md", "Old/"],
        },
        screen: "computer",
        url: "/files?path=&root=~%2FRecipes",
      },
    });

    const [chat] = await listChats();

    expect(chat?.holds.files).toEqual([
      "/Users/sam/Recipes/soup.md",
      "/Users/sam/Recipes/Old/",
    ]);
  });

  it("holds what the user sent behind what the chat made, and none of the tabs merely open", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "price out this cart", 1, {
      attachments: ["attachments/receipt.png"],
      viewing: {
        chosen: [
          {
            kind: "folder",
            mount: "/Users/sam/Recipes",
            name: "Recipes",
            path: "/Users/someone/Recipes",
          },
          // Outside every folder the chat reaches, so it has no path to hold.
          { kind: "file", name: "notes.txt", path: "/Volumes/Stick/notes.txt" },
        ],
        page: {
          title: "Cart",
          url: "https://www.instacart.com/store/cart",
        },
        screen: "browser",
        tabs: [
          { at: "https://www.amazon.com/", id: "t1", title: "Amazon" },
          {
            at: "https://www.instacart.com/store/cart",
            id: "t2",
            title: "Cart",
          },
        ],
        url: "https://www.instacart.com/store/cart",
      },
    });
    await agentSays(
      chatId,
      sessionId,
      "Priced.\n\n```files\n/Users/sam/Instrument/groceries/prices.csv\n```",
      {
        commands: ["instrument window show https://www.costco.com/"],
        minute: 2,
      },
    );
    await userSays(
      chatId,
      sessionId,
      "and this one, then file it in [Linear](instrument://app/linear)",
      3,
      {
        viewing: {
          file: {
            mount: "/Users/sam/Instrument/groceries/prices.csv",
            name: "prices.csv",
            path: "/Users/someone/Documents/Instrument/groceries/prices.csv",
          },
          screen: "file",
          url: "file:///Users/someone/Documents/Instrument/groceries/prices.csv",
        },
      },
    );

    const [chat] = await listChats();

    expect(chat?.holds).toEqual({
      apps: ["linear"],
      files: [
        "/Users/sam/Recipes/",
        "attachments/receipt.png",
        "/Users/sam/Instrument/groceries/prices.csv",
      ],
      sites: ["www.instacart.com", "www.costco.com"],
    });
  });

  it("holds a page chipped beside the one in view", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "compare these", 1, {
      viewing: {
        attached: [
          { kind: "page", title: "Cart", url: "https://www.amazon.com/cart" },
          {
            kind: "page",
            title: "Store",
            url: "https://www.instacart.com/store",
          },
        ],
        page: { title: "Store", url: "https://www.instacart.com/store" },
        screen: "browser",
        url: "https://www.instacart.com/store",
      },
    });

    const [chat] = await listChats();

    expect(chat?.holds.sites).toEqual(["www.instacart.com", "www.amazon.com"]);
  });
});

describe("liveChatList", () => {
  /**
   * The live list, followed: `next` answers with the list's next answer, or
   * none if nothing comes within a moment.
   */
  async function open() {
    const controller = new AbortController();
    const answers: Chat[][] = [];
    let wake: (() => void) | undefined;
    // Ends with the abort's error, as a live route does when its request goes.
    void (async () => {
      for await (const answer of liveChatList(controller.signal)) {
        answers.push(answer);
        wake?.();
      }
    })().catch(() => undefined);
    const next = async () => {
      if (answers.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 200);
        });
      }
      return answers.shift();
    };
    return {
      first: await next(),
      next,
      stop: () => {
        controller.abort();
      },
    };
  }

  it("drops a deleted chat's row, though the index forgot the chat before anything heard", async () => {
    const chatId = await freshChat();
    const kept = await session(chatId, "Groceries", 1);
    await userSays(chatId, kept, "make me a grocery list", 1);
    const deleted = await session(chatId, "Taxes", 2);
    await userSays(chatId, deleted, "file my taxes", 2);
    const { first, next, stop } = await open();
    expect(first?.map((chat) => chat.sessionId)).toEqual([kept, deleted]);

    const gone = await chatFor(deleted);
    forgetChat(gone);
    recordRemoved(gone);

    expect((await next())?.map((chat) => chat.sessionId)).toEqual([kept]);
    stop();
  });

  it("drops a chat whose folder was deleted behind the app's back, and says so once", async () => {
    const chatId = await freshChat();
    const kept = await session(chatId, "Groceries", 1);
    await userSays(chatId, kept, "make me a grocery list", 1);
    const deleted = await session(chatId, "Taxes", 2);
    await userSays(chatId, deleted, "file my taxes", 2);
    const config = getWorkspaceConfig();
    const arrivals = await startRecordArrivals({
      chatsDir: config.chatsDir,
      device: config.deviceId,
    });
    const removed: string[] = [];
    const unsubscribe = publisher.subscribe("record.changed", (change) => {
      if (change.kind === "removed") {
        removed.push(change.id);
      }
    });
    const { first, next, stop } = await open();
    try {
      expect(first?.map((chat) => chat.sessionId)).toEqual([kept, deleted]);

      const gone = await chatFor(deleted);
      fs.rmSync(chatDir(gone), { force: true, recursive: true });
      await arrivals.look();

      expect((await next())?.map((chat) => chat.sessionId)).toEqual([kept]);
      expect(listChatIds()).not.toContain(gone);
      await arrivals.look();
      await chatGone(gone);
      expect(removed).toEqual([gone]);
    } finally {
      stop();
      unsubscribe();
      stopRecordArrivals();
    }
  });

  it("says a chat is idle once its turn ends, which writes nothing", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    alive.value = new Set([sessionId]);
    const { first, next, stop } = await open();
    expect(first?.[0]?.state).toBe("working");

    alive.value = new Set();
    recordChanged(await chatFor(sessionId), "agent");

    expect((await next())?.[0]?.state).toBe("idle");
    stop();
  });

  // The quit leaves the chat a note naming the tasks it cut off, written as a
  // user message that starts no turn. A relaunch right after it must not read
  // it as a turn starting: nothing would run it.
  it("says a chat is idle on its first answer after a relaunch, past the note the quit left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Groceries", 1);
      await userSays(chatId, sessionId, "make me a grocery list", 1);
      await agentSays(chatId, sessionId, "A task is on it.", { minute: 2 });
      const noteId = StoreId.newMessageId();
      const saved = await ChatWrites.saveMessageWithParts(
        {
          id: noteId,
          metadata: { createdAt: at(3), sessionId },
          parts: [
            {
              data: {
                events: [
                  {
                    ended: "The app closed while counting",
                    handle: "t1",
                    sessionId: StoreId.newSessionId(),
                    status: "done",
                    stoppedBy: "app",
                    title: "Count the lines",
                  },
                ],
              },
              metadata: partMetadata({ messageId: noteId, sessionId }),
              type: "data-taskEvent",
            },
          ],
          role: "user",
        },
        await chatFor(sessionId),
      );
      expect(saved.isOk()).toBe(true);

      vi.setSystemTime(at(3).getTime() + 5000);
      const { first, stop } = await open();
      expect(first?.[0]?.state).toBe("idle");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a row's apps when the workspace's apps change", async () => {
    const chatId = await freshChat();
    const appsDir = path.join(getWorkspaceConfig().rootDir, "apps");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      appsDir: AbsolutePathSchema.parse(appsDir),
    });
    const sessionId = await session(chatId, "Groceries");
    await userSays(
      chatId,
      sessionId,
      "file it in [Linear](instrument://app/linear)",
      1,
    );
    const { first, next, stop } = await open();
    // No apps folder yet: nothing is known, so nothing is filtered.
    expect(first?.[0]?.holds.apps).toEqual(["linear"]);

    fs.mkdirSync(path.join(appsDir, "Drafts"), { recursive: true });
    fs.writeFileSync(
      path.join(appsDir, "Drafts", APP_FILE_NAME),
      [
        "---",
        "id: drafts",
        "type: mcp-local",
        "package: '@agiletortoise/drafts-mcp-server'",
        "runtime: node",
        "auth:",
        "  kind: none",
        "---",
        "",
      ].join("\n"),
    );
    publisher.publish("app.updated", null);

    expect((await next())?.[0]?.holds.apps).toEqual([]);
    stop();
  });

  it("reads a rename and a star into the row", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const { next, stop } = await open();

    await renameChat(await chatFor(sessionId), "Weekly shop");
    expect((await next())?.[0]?.title).toBe("Weekly shop");
    await setChatStarred(await chatFor(sessionId), true);
    expect((await next())?.[0]?.starred).toBe(true);
    stop();
  });

  // A window paints the topic from the click; a topic removed before the
  // request lands files the chat under none, which writes nothing, so the
  // only answer that takes the paint back is the same list sent again.
  it("answers a request to change a row with the row as it stands, though nothing changed", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const id = await chatFor(sessionId);
    const { first, next, stop } = await open();

    await setChatTopic(id, "top_removed");
    recordChanged(id, "settings");
    expect(await next()).toBeUndefined();

    chatRowAsked(id);
    expect(await next()).toEqual(first);
    expect(await next()).toBeUndefined();

    chatRowAsked(ChatIdSchema.parse("chats-not-there"));
    expect(await next()).toEqual(first);
    stop();
  });

  it("reads a filed task's step into its chat's row, and sends nothing for a change no row shows", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const child = await fileTask(sessionId);
    const { next, stop } = await open();

    recordChanged(await chatFor(sessionId), "settings");
    expect(await next()).toBeUndefined();

    running.value = [
      {
        chat: sessionId,
        step: "Checking the pantry",
        sessionId: child,
        title: "Grocery list",
        updatedAt: at(3).getTime(),
      },
    ];
    recordChanged(await chatFor(sessionId), "messages");
    expect((await next())?.[0]?.runningTasks).toEqual([
      { id: child, step: "Checking the pantry", title: "Grocery list" },
    ]);
    stop();
  });

  it("names the step a call still arriving says, over the written one", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "", {
      commands: ["task list"],
      finished: false,
      minute: 2,
    });
    alive.value = new Set([sessionId]);

    const messageId = StoreId.newMessageId();
    const live = chatRecords().live(await chatFor(sessionId), sessionId);
    live.setMessage({
      id: messageId,
      metadata: {
        createdAt: at(3),
        finishReason: "unknown",
        modelId: "glm-5.3-flash",
        providerId: "openai-compatible",
        sessionId,
      },
      role: "assistant",
    });
    live.setPart(
      SessionMessagePart.coerce({
        input: { activity: "Reading the list", command: "cat li" },
        metadata: {
          createdAt: at(3),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        state: "input-streaming",
        toolCallId: "call-1",
        type: "tool-bash",
      }),
    );

    try {
      const [chat] = await listChats();

      expect(chat?.latest).toMatchObject({
        kind: "step",
        text: "Reading the list",
      });
    } finally {
      await live.clear();
    }
  });
});

describe("startChatListFile", () => {
  it("writes this device's chat list once it is read, and again once a row changes", async () => {
    const chatId = await freshChat();
    const groceries = await session(chatId, "Groceries", 1);
    await userSays(chatId, groceries, "make me a grocery list", 1);
    const config = getWorkspaceConfig();
    const file = path.join(
      workspaceLayout(config.rootDir).devicesDir,
      config.deviceId,
      CHAT_LIST_FILE_NAME,
    );
    const read = () =>
      JSON.parse(fs.readFileSync(file, "utf8")) as {
        chats: Record<string, unknown>[];
        device: string;
        format: number;
      };
    const controller = new AbortController();
    startChatListFile({ signal: controller.signal, writeAfterMs: 10 });
    try {
      await vi.waitFor(() => {
        expect(fs.existsSync(file)).toBe(true);
      });
      const written = read();
      expect(written.format).toBe(1);
      expect(written.device).toBe(config.deviceId);
      expect(written.chats.map((chat) => chat.title)).toEqual(["Groceries"]);
      // What only a running process knows, and the opening message, stay out.
      expect(Object.keys(written.chats[0] ?? {})).not.toContain("root");
      expect(Object.keys(written.chats[0] ?? {})).not.toContain("working");

      const [chat] = await listChats();
      if (!chat) {
        throw new Error("The chat is not listed");
      }
      await setChatStarred(chat.id, true);
      await vi.waitFor(() => {
        expect(read().chats[0]?.starred).toBe(true);
      });
    } finally {
      controller.abort();
    }
  });

  it("writes a moment after a turn ends, without waiting out the wait between writes", async () => {
    const chatId = await freshChat();
    const groceries = await session(chatId, "Groceries", 1);
    await userSays(chatId, groceries, "make me a grocery list", 1);
    const config = getWorkspaceConfig();
    const file = path.join(
      workspaceLayout(config.rootDir).devicesDir,
      config.deviceId,
      CHAT_LIST_FILE_NAME,
    );
    const starred = () =>
      (
        JSON.parse(fs.readFileSync(file, "utf8")) as {
          chats: { starred: boolean }[];
        }
      ).chats[0]?.starred;
    const controller = new AbortController();
    startChatListFile({
      signal: controller.signal,
      turnEndWriteMs: 10,
      writeAfterMs: 60_000,
    });
    try {
      await vi.waitFor(() => {
        expect(fs.existsSync(file)).toBe(true);
      });
      const [chat] = await listChats();
      if (!chat) {
        throw new Error("The chat is not listed");
      }
      await setChatStarred(chat.id, true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(starred()).toBe(false);

      publisher.publish("session.done", { id: chat.id, sessionId: groceries });
      await vi.waitFor(() => {
        expect(starred()).toBe(true);
      });
    } finally {
      controller.abort();
    }
  });
});
