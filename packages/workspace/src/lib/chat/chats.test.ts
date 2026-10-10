import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { recordChanged, recordRemoved } from "../record-changes";
import { forgetChat, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type ChatActivity } from "./activity";
import {
  archiveChat,
  type Chat,
  listChats,
  markChatRead,
  markChatUnread,
  startChatUnreadOnSettle,
  renameChat,
  setChatStarred,
  setChatTopics,
  unarchiveChat,
} from "./chats";
import { liveChatList } from "./live-chat-list";
import { createTopic } from "./topics";

vi.mock(import("../session-store-storage"));

const running = vi.hoisted(() => {
  const value: ChatActivity["running"] = [];
  return { value };
});
const alive = vi.hoisted(() => ({ value: new Set<string>() }));
const pendingWakes = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock(import("./wake"), () => ({
  hasPendingWake: (chatId: string) => pendingWakes.value.has(chatId),
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
/**
 * A workspace of its own: chats, topics and the window's state all live
 * under the root, so each test gets one.
 */
const freshChat = async () => {
  const chatId = createMockChatConfig(
    ChatIdSchema.parse(`chats-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chats-root-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    tasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
  });
  return chatId;
};

/** A task started in a chat: a session in that chat's store. */
function fileTask(sessionId: StoreId.Session, title = "Grocery list") {
  return chatTaskFor(chatFor(sessionId), { title });
}

beforeEach(() => {
  running.value = [];
  alive.value = new Set();
  pendingWakes.value = new Set();
});

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

async function agentAsks(_taskId: ChatId, sessionId: StoreId.Session) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at(5),
      finishedAt: at(5),
      finishReason: "tool-calls",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      {
        input: { choices: ["Yes", "No"], question: "Which one?" },
        metadata: partMetadata({ messageId, sessionId }),
        state: "input-available",
        toolCallId: "call_choose",
        type: "tool-choose",
      },
    ],
    role: "assistant",
  };
  const saved = await Store.saveMessageWithParts(message, chatFor(sessionId));
  expect(saved.isOk()).toBe(true);
}

/** A finished reply, with words and whatever tool calls it made. */
async function agentSays(
  _taskId: ChatId,
  sessionId: StoreId.Session,
  text: string,
  {
    commands = [],
    failed = false,
    finished = true,
    minute = 0,
  }: {
    commands?: string[];
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
      finishReason: failed ? "error" : "stop",
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
  const saved = await Store.saveMessageWithParts(message, chatFor(sessionId));
  expect(saved.isOk()).toBe(true);
  return messageId;
}

function partMetadata(ids: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return { createdAt: new Date(), id: StoreId.newPartId(), ...ids };
}

/** A chat: a chat's folder and its one session. */
async function session(_taskId: ChatId, title: string, minute = 0) {
  const id = StoreId.newSessionId();
  chatFor(id);
  await Store.saveSession(
    { createdAt: at(minute), id, title, updatedAt: at(minute) },
    chatFor(id),
  );
  return id;
}

async function userSays(
  _taskId: ChatId,
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
  const saved = await Store.saveMessageWithParts(message, chatFor(sessionId));
  expect(saved.isOk()).toBe(true);
  return messageId;
}

describe("listChats", () => {
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
    const saved = await Store.saveMessageWithParts(
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
      chatFor(sessionId),
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

    const read = await Store.getMessagesWithParts({
      sessionId,
      chatId: chatFor(sessionId),
    });
    const reply = read
      ._unsafeUnwrap()
      .find((message) => message.role === "assistant");
    const part = reply?.parts.find((entry) => entry.type === "text");
    if (!part) {
      throw new Error("no reply text");
    }
    await Store.savePart(
      { ...part, text: "Here is the new list." },
      chatFor(sessionId),
    );
    const [rewritten] = await listChats();
    expect(rewritten?.latest?.text).toBe("Here is the new list.");
  });

  it("marks any chat unread and read again, whatever it holds", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);

    await markChatUnread(chatFor(sessionId), { byUser: true });
    const [marked] = await listChats();
    expect(marked).toMatchObject({ unread: true, unreadByUser: true });

    await markChatRead(chatFor(sessionId));
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

    publisher.publish("session.done", { id: chatFor(sessionId), sessionId });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [working] = await listChats();
    expect(working?.unread).toBe(false);

    running.value = [];
    publisher.publish("session.done", { id: chatFor(sessionId), sessionId });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [settled] = await listChats();
    expect(settled).toMatchObject({ unread: true, unreadByUser: false });
  });

  it("keeps a mark the user set theirs when the chat settles under it", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);

    await markChatUnread(chatFor(sessionId), { byUser: true });
    await markChatUnread(chatFor(sessionId), { byUser: false });
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

  it("leaves a failed turn behind once the user sends again", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "hru");
    await userSays(chatId, sessionId, "hru", 1);
    await agentSays(chatId, sessionId, "", { failed: true, minute: 2 });
    await userSays(chatId, sessionId, "hello?", 3);

    const [chat] = await listChats();
    expect(chat?.state).not.toBe("failed");
  });

  it("carries the topics a chat is tagged with, dropping ids that are not topics", async () => {
    const chatId = await freshChat();
    const home = await createTopic({ name: "Home" });
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list");

    await setChatTopics(chatFor(sessionId), [home.id, "top_nothing"]);

    const [chat] = await listChats();
    expect(chat?.topics).toEqual([home.id]);
  });

  it("puts a chat away and brings it back, without moving its stamp", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();
    expect(before?.archived).toBe(false);

    await archiveChat(chatFor(sessionId));
    const [archived] = await listChats();
    expect(archived?.archived).toBe(true);
    expect(archived?.updatedAt).toBe(before?.updatedAt);

    await unarchiveChat(chatFor(sessionId));
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

    await setChatStarred(chatFor(sessionId), true);
    const [starred] = await listChats();
    expect(starred?.starred).toBe(true);
    expect(starred?.updatedAt).toBe(before?.updatedAt);

    await setChatStarred(chatFor(sessionId), false);
    const [back] = await listChats();
    expect(back?.starred).toBe(false);
  });

  it("takes the name the user typed, without moving its stamp", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries", 1);
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();

    await renameChat(chatFor(sessionId), "Weekly shop");
    const [renamed] = await listChats();
    expect(renamed?.title).toBe("Weekly shop");
    expect(renamed?.updatedAt).toBe(before?.updatedAt);
    const stored = await Store.getSession(sessionId, chatFor(sessionId));
    expect(stored._unsafeUnwrap().titleSettledAt).toBeInstanceOf(Date);
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

  it("waits, rather than works, while a task filed from it is stopped on an ask", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
    const child = await fileTask(sessionId);
    running.value = [
      {
        chat: sessionId,
        step: "Picking a store",
        sessionId: child,
        title: "Grocery list",
        updatedAt: at(3).getTime(),
        waiting: "Which one?",
      },
    ];

    const [chat] = await listChats();

    expect(chat?.state).toBe("waiting");
    expect(chat?.latest).toEqual({
      at: at(3).getTime(),
      kind: "question",
      text: "Which one?",
    });
    expect(chat?.runningTasks).toEqual([
      {
        id: child,
        step: "Picking a store",
        title: "Grocery list",
        waiting: "Which one?",
      },
    ]);

    // Another task still moving keeps the chat at work, and its step is
    // the one shown rather than the stalled task's.
    running.value = [
      ...running.value,
      {
        chat: sessionId,
        step: "Checking the pantry",
        sessionId: await fileTask(sessionId, "Pantry"),
        title: "Pantry",
        updatedAt: at(4).getTime(),
      },
    ];
    const [busy] = await listChats();
    expect(busy?.state).toBe("working");
    expect(busy?.latest?.text).toBe("Checking the pantry");
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

  // A message is written before the agent it starts is running, so a list
  // read in between must not call the chat idle and show its last reply.
  it("is working while a message it was just sent waits for its agent, for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const chatId = await freshChat();
      const sessionId = await session(chatId, "Groceries", 1);
      await userSays(chatId, sessionId, "make me a grocery list", 1);
      await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
      await userSays(chatId, sessionId, "add eggs", 3);

      vi.setSystemTime(at(3).getTime() + 5000);
      const soon = await listChats();
      expect(soon[0]?.state).toBe("working");

      vi.setSystemTime(at(3).getTime() + 60_000);
      const later = await listChats();
      expect(later[0]?.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is working while a task filed from it has finished and its wake waits to be written", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentSays(chatId, sessionId, "Starting the list.", { minute: 2 });
    await fileTask(sessionId);
    pendingWakes.value = new Set([chatFor(sessionId)]);

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
  });

  it("is waiting while its last turn ended on a question", async () => {
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

  it("is waiting, not working, while its own agent stands on the question it asked", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    await agentAsks(chatId, sessionId);
    // The agent is alive to the machine: its turn is open on the tool call.
    alive.value = new Set([sessionId]);
    try {
      const [chat] = await listChats();
      expect(chat?.state).toBe("waiting");
      expect(chat?.latest?.kind).toBe("question");
    } finally {
      alive.value = new Set();
    }
  });

  it("reads a reply that is only the files it handed over by what it wrote", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Compare");
    await userSays(chatId, sessionId, "compare the two quotes", 1);
    await agentSays(
      chatId,
      sessionId,
      "```files\n/mnt/Instrument/quotes/compared.html\n```",
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
      "```files\n/mnt/Instrument/quotes/a.md\n/mnt/Instrument/quotes/b.png\n/mnt/Instrument/quotes/c.html\n```",
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
      "Here it is.\n\n```files\n/mnt/Instrument/groceries/list.md\n```",
      {
        commands: [
          'app call notion search \'{"query":"groceries"}\'',
          "tab open https://www.instacart.com/store",
        ],
        minute: 2,
      },
    );
    await agentSays(
      chatId,
      sessionId,
      "Updated.\n\n```files\n/mnt/Instrument/groceries/list.md\n/mnt/Instrument/groceries/prices.csv\n```",
      { minute: 3 },
    );

    const [chat] = await listChats();

    expect(chat?.holds).toEqual({
      apps: ["notion"],
      files: [
        "/mnt/Instrument/groceries/list.md",
        "/mnt/Instrument/groceries/prices.csv",
      ],
      sites: ["www.instacart.com"],
    });
  });

  it("holds what was selected in a folder the user sent from, in place of the folder", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Recipes");
    await userSays(chatId, sessionId, "tidy these", 1, {
      viewing: {
        folder: {
          display: "~/Recipes",
          mount: "/mnt/Home/Recipes",
          selected: ["soup.md", "Old/"],
        },
        screen: "computer",
        url: "/files?path=&root=~%2FRecipes",
      },
    });

    const [chat] = await listChats();

    expect(chat?.holds.files).toEqual([
      "/mnt/Home/Recipes/soup.md",
      "/mnt/Home/Recipes/Old/",
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
            mount: "/mnt/Home/Recipes",
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
      "Priced.\n\n```files\n/mnt/Instrument/groceries/prices.csv\n```",
      { commands: ["tab open https://www.costco.com/"], minute: 2 },
    );
    await userSays(
      chatId,
      sessionId,
      "and this one, then file it in [Linear](instrument://app/linear)",
      3,
      {
        viewing: {
          file: {
            mount: "/mnt/Instrument/groceries/prices.csv",
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
        "/mnt/Home/Recipes/",
        "attachments/receipt.png",
        "/mnt/Instrument/groceries/prices.csv",
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

    const gone = chatFor(deleted);
    forgetChat(gone);
    recordRemoved(gone);

    expect((await next())?.map((chat) => chat.sessionId)).toEqual([kept]);
    stop();
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
    recordChanged(chatFor(sessionId), "agent");

    expect((await next())?.[0]?.state).toBe("idle");
    stop();
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

    fs.mkdirSync(path.join(appsDir, "drafts"), { recursive: true });
    fs.writeFileSync(
      path.join(appsDir, "drafts", "app.json"),
      JSON.stringify({
        auth: { kind: "none" },
        name: "Drafts",
        package: "@agiletortoise/drafts-mcp-server",
        runtime: "node",
        type: "mcp-local",
      }),
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

    await renameChat(chatFor(sessionId), "Weekly shop");
    expect((await next())?.[0]?.title).toBe("Weekly shop");
    await setChatStarred(chatFor(sessionId), true);
    expect((await next())?.[0]?.starred).toBe(true);
    stop();
  });

  it("reads a filed task's step into its chat's row, and sends nothing for a change no row shows", async () => {
    const chatId = await freshChat();
    const sessionId = await session(chatId, "Groceries");
    await userSays(chatId, sessionId, "make me a grocery list", 1);
    const child = await fileTask(sessionId);
    const { next, stop } = await open();

    recordChanged(chatFor(sessionId), "settings");
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
    recordChanged(chatFor(sessionId), "messages");
    expect((await next())?.[0]?.runningTasks).toEqual([
      { id: child, step: "Checking the pantry", title: "Grocery list" },
    ]);
    stop();
  });
});
