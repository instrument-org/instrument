import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RelativePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { placeTask, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { getWindowState, updateWindowState } from "../window-state";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type ChatActivity } from "./activity";
import {
  archiveChat,
  chatById,
  listChats,
  markChatSeen,
  markChatUnseen,
  renameChat,
  setChatStarred,
  setChatTopics,
  unarchiveChat,
} from "./chats";
import { createTopic } from "./topics";
import { type ChatId } from "../../schemas/chat-id";

vi.mock(import("../session-store-storage"));

const running = vi.hoisted(() => {
  const value: ChatActivity["running"] = [];
  return { value };
});
const alive = vi.hoisted(() => ({ value: new Set<string>() }));
const pendingWakes = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock(import("./wake"), () => ({
  hasPendingWake: (_chatId: string, taskId: string) =>
    pendingWakes.value.has(taskId),
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
          sessionRefsByTaskId: {
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
const freshTask = async () => {
  const taskId = createMockTaskConfig(
    TaskIdSchema.parse(`chats-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chats-root-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    tasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
  });
  // The window's state begins with the workspace, before any chat in it.
  await getWindowState();
  return taskId;
};

/** A task started in a chat: a folder inside that chat's record. */
function fileTask(sessionId: StoreId.Session, child: TaskId) {
  const dir = placeTask(child, chatFor(sessionId));
  fs.mkdirSync(dir, { recursive: true });
}

beforeEach(() => {
  running.value = [];
  alive.value = new Set();
  pendingWakes.value = new Set();
});

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

async function agentAsks(_taskId: TaskId, sessionId: StoreId.Session) {
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
  _taskId: TaskId,
  sessionId: StoreId.Session,
  text: string,
  {
    commands = [],
    finished = true,
    minute = 0,
  }: { commands?: string[]; finished?: boolean; minute?: number } = {},
) {
  const messageId = StoreId.newMessageId();
  const ids = { messageId, sessionId };
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at(minute),
      finishReason: "stop",
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
async function session(_taskId: TaskId, title: string, minute = 0) {
  const id = StoreId.newSessionId();
  chatFor(id);
  await Store.saveSession(
    { createdAt: at(minute), id, title, updatedAt: at(minute) },
    chatFor(id),
  );
  return id;
}

async function userSays(
  _taskId: TaskId,
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
    const taskId = await freshTask();
    const groceries = await session(taskId, "Groceries for the week", 1);
    await userSays(taskId, groceries, "make me a grocery list", 1);
    await agentSays(taskId, groceries, "Starting the list.\nMore below.", {
      minute: 2,
    });
    await agentSays(taskId, groceries, "", { minute: 3 });
    const trip = await session(taskId, "Trip to Lisbon", 4);
    await userSays(taskId, trip, "plan a trip to lisbon", 4);

    const chats = await listChats();

    expect(
      chats.map((chat) => ({
        createdAt: chat.createdAt,
        latest: chat.latest,
        replyCount: chat.replyCount,
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
        replyCount: 1,
        root: "make me a grocery list",
        state: "idle",
        title: "Groceries for the week",
        unread: 2,
      },
      {
        createdAt: at(4).getTime(),
        latest: undefined,
        replyCount: 0,
        root: "plan a trip to lisbon",
        state: "idle",
        title: "Trip to Lisbon",
        unread: 0,
      },
    ]);
  });

  it("lets the ask stand for a chat the agent has not named yet", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Untitled chat 3");
    await userSays(taskId, sessionId, "plan a trip to lisbon\nin october", 1);

    const [chat] = await listChats();
    expect(chat?.title).toBe("plan a trip to lisbon");
  });

  it("lists a chat whose first message has not been saved yet", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Untitled chat 4", 2);

    const [chat] = await listChats();
    expect(chat?.id).toBe(sessionId);
    expect(chat?.createdAt).toBe(at(2).getTime());
  });

  it("lists a chat started with only an ask marked on a file", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Make page 1 red");
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
    expect(chat?.id).toBe(sessionId);
  });

  it("reads what was said since the last list, and a part rewritten in place", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    const [asked] = await listChats();
    expect(asked?.replyCount).toBe(0);

    await agentSays(taskId, sessionId, "Here is the list.", { minute: 2 });
    const [replied] = await listChats();
    expect(replied?.latest?.text).toBe("Here is the list.");

    const read = await Store.getMessagesWithParts({
      sessionId,
      taskId: chatFor(sessionId),
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

  it("does not count a reply that is still being written as new", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Working on it", {
      finished: false,
      minute: 2,
    });

    const [chat] = await listChats();
    expect(chat?.unread).toBe(0);
  });

  it("puts one reply back among the unread when asked, and clears it again on seeing", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    await agentSays(taskId, sessionId, "One more thing.", { minute: 3 });
    await markChatSeen(sessionId);

    await markChatUnseen(sessionId);
    const [put] = await listChats();
    expect(put?.unread).toBe(1);

    await markChatSeen(sessionId);
    const [seen] = await listChats();
    expect(seen?.unread).toBe(0);
  });

  it("counts a chat with no seen mark as seen up to the window's floor", async () => {
    const taskId = await freshTask();
    const before = await session(taskId, "Before the window");
    await userSays(taskId, before, "make me a grocery list", 1);
    await agentSays(taskId, before, "Here it is.", { minute: 2 });
    // A workspace whose window state began after its chats.
    await updateWindowState(() => ({ seenFloor: StoreId.newMessageId() }));
    const after = await session(taskId, "After the window");
    await userSays(taskId, after, "plan a trip", 3);
    await agentSays(taskId, after, "Here is the plan.", { minute: 4 });

    const chats = await listChats();
    expect(
      Object.fromEntries(chats.map((chat) => [chat.title, chat.unread])),
    ).toEqual({ "After the window": 1, "Before the window": 0 });
  });

  it("records the floor once, and keeps it", async () => {
    await freshTask();
    const { seenFloor } = await getWindowState();
    expect(seenFloor).toBeDefined();
    await updateWindowState(() => ({ chatSeen: {} }));
    expect((await getWindowState()).seenFloor).toBe(seenFloor);
  });

  it("reads a chat's own mark below the floor over the floor", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    const asked = await userSays(taskId, sessionId, "make me a list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    await updateWindowState(() => ({
      chatSeen: { [sessionId]: asked },
      seenFloor: StoreId.newMessageId(),
    }));

    const [chat] = await listChats();
    expect(chat?.unread).toBe(1);
  });

  it("puts a chat's only reply back among the unread when the floor is past it", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    await updateWindowState(() => ({ seenFloor: StoreId.newMessageId() }));

    await markChatUnseen(sessionId);
    const [chat] = await listChats();
    expect(chat?.unread).toBe(1);
  });

  it("clears the count once seen, and counts again from there", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Done.", { minute: 2 });

    await markChatSeen(sessionId);
    await agentSays(taskId, sessionId, "One more thing.", { minute: 3 });

    const [chat] = await listChats();
    expect(chat?.unread).toBe(1);
    // A reply still arriving is not settled, so seeing the chat now records
    // the reply before it.
    const streaming = await agentSays(taskId, sessionId, "Working on", {
      finished: false,
      minute: 4,
    });
    const seen = await chatById(sessionId);
    const settled = seen?.newestSettledMessageId;
    expect(settled).toBeDefined();
    expect(settled).not.toBe(streaming);
  });

  it("carries the topics a chat is tagged with, dropping ids that are not topics", async () => {
    const taskId = await freshTask();
    const home = await createTopic({ name: "Home" });
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list");

    await setChatTopics(sessionId, [home.id, "top_nothing"]);

    const [chat] = await listChats();
    expect(chat?.topics).toEqual([home.id]);
  });

  it("puts a chat away and brings it back, without moving its stamp", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();
    expect(before?.archived).toBe(false);

    await archiveChat(sessionId);
    const [archived] = await listChats();
    expect(archived?.archived).toBe(true);
    expect(archived?.updatedAt).toBe(before?.updatedAt);

    await unarchiveChat(sessionId);
    const [back] = await listChats();
    expect(back?.archived).toBe(false);
  });

  it("stars a chat and takes the star off, without moving its stamp", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();
    expect(before?.starred).toBe(false);

    await setChatStarred(sessionId, true);
    const [starred] = await listChats();
    expect(starred?.starred).toBe(true);
    expect(starred?.updatedAt).toBe(before?.updatedAt);

    await setChatStarred(sessionId, false);
    const [back] = await listChats();
    expect(back?.starred).toBe(false);
  });

  it("takes the name the user typed, without moving its stamp", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listChats();

    await renameChat(sessionId, "Weekly shop");
    const [renamed] = await listChats();
    expect(renamed?.title).toBe("Weekly shop");
    expect(renamed?.updatedAt).toBe(before?.updatedAt);
    const stored = await Store.getSession(sessionId, chatFor(sessionId));
    expect(stored._unsafeUnwrap().titleSettledAt).toBeInstanceOf(Date);
  });

  it("is working while a task filed from it runs, and says its step", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list");
    fileTask(sessionId, child);
    running.value = [
      {
        chat: sessionId,
        step: "Checking the pantry",
        taskId: child,
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
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list");
    fileTask(sessionId, child);
    running.value = [
      {
        chat: sessionId,
        step: "Picking a store",
        taskId: child,
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
        taskId: TaskIdSchema.parse("pantry"),
        title: "Pantry",
        updatedAt: at(4).getTime(),
      },
    ];
    const [busy] = await listChats();
    expect(busy?.state).toBe("working");
    expect(busy?.latest?.text).toBe("Checking the pantry");
  });

  it("is working while its own agent is alive, saying what it is doing", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "", {
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
      const taskId = await freshTask();
      const sessionId = await session(taskId, "Groceries", 1);
      await userSays(taskId, sessionId, "make me a grocery list", 1);
      await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
      await userSays(taskId, sessionId, "add eggs", 3);

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
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list-done");
    fileTask(sessionId, child);
    pendingWakes.value = new Set([child]);

    const [chat] = await listChats();

    expect(chat?.state).toBe("working");
  });

  it("is waiting while its last turn ended on a question", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentAsks(taskId, sessionId);

    const [chat] = await listChats();

    expect(chat?.state).toBe("waiting");
    expect(chat?.latest).toEqual({
      at: at(5).getTime(),
      kind: "question",
      text: "Which one?",
    });
  });

  it("is waiting, not working, while its own agent stands on the question it asked", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentAsks(taskId, sessionId);
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
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Compare");
    await userSays(taskId, sessionId, "compare the two quotes", 1);
    await agentSays(
      taskId,
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
      taskId,
      sessionId,
      "```files\n/mnt/Instrument/quotes/a.md\n/mnt/Instrument/quotes/b.png\n/mnt/Instrument/quotes/c.html\n```",
      { minute: 3 },
    );
    const [updated] = await listChats();
    expect(updated?.latest?.text).toBe("Wrote 3 files: a.md, b.png, c.html");
    expect(updated?.replyCount).toBe(2);
  });

  it("reads what the chat made and used out of its replies", async () => {
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(
      taskId,
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
      taskId,
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
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Recipes");
    await userSays(taskId, sessionId, "tidy these", 1, {
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
    const taskId = await freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "price out this cart", 1, {
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
      taskId,
      sessionId,
      "Priced.\n\n```files\n/mnt/Instrument/groceries/prices.csv\n```",
      { commands: ["tab open https://www.costco.com/"], minute: 2 },
    );
    await userSays(
      taskId,
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
});
