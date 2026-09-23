import { beforeEach, describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { setTaskState } from "../task-record";
import { type OrchestratorActivity } from "./activity";
import {
  archiveThread,
  listThreads,
  markThreadSeen,
  markThreadUnseen,
  renameThread,
  setThreadStarred,
  setThreadTopics,
  threadById,
  unarchiveThread,
} from "./threads";
import { createTopic } from "./topics";

vi.mock(import("../session-store-storage"));

const running = vi.hoisted(() => {
  const value: OrchestratorActivity["running"] = [];
  return { value };
});
const alive = vi.hoisted(() => ({ value: new Set<string>() }));
const pendingWakes = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock(import("./wake"), () => ({
  hasPendingWake: (_orchestratorId: string, taskId: string) =>
    pendingWakes.value.has(taskId),
}));

// What the machine would say: which tasks are at work, and which sessions
// have a live agent. Neither exists in a test, so both are dials.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  orchestratorActivity: () => Promise.resolve({ running: running.value }),
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
// id reused across runs would read the last run's threads.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`threads-${Date.now()}-${(counter += 1)}`),
  );

beforeEach(() => {
  running.value = [];
  alive.value = new Set();
  pendingWakes.value = new Set();
});

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

async function agentAsks(taskId: TaskId, sessionId: StoreId.Session) {
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
  const saved = await Store.saveMessageWithParts(message, taskId);
  expect(saved.isOk()).toBe(true);
}

/** A finished reply, with words and whatever tool calls it made. */
async function agentSays(
  taskId: TaskId,
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
  const saved = await Store.saveMessageWithParts(message, taskId);
  expect(saved.isOk()).toBe(true);
  return messageId;
}

function partMetadata(ids: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}) {
  return { createdAt: new Date(), id: StoreId.newPartId(), ...ids };
}

async function session(taskId: TaskId, title: string, minute = 0) {
  const id = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: at(minute), id, title, updatedAt: at(minute) },
    taskId,
  );
  return id;
}

async function userSays(
  taskId: TaskId,
  sessionId: StoreId.Session,
  text: string,
  minute = 0,
) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt: at(minute), sessionId },
    parts: [
      { metadata: partMetadata({ messageId, sessionId }), text, type: "text" },
    ],
    role: "user",
  };
  const saved = await Store.saveMessageWithParts(message, taskId);
  expect(saved.isOk()).toBe(true);
  return messageId;
}

describe("listThreads", () => {
  it("lists the threads oldest first, with their roots, counts and latest lines", async () => {
    const taskId = freshTask();
    const groceries = await session(taskId, "Groceries for the week", 1);
    await userSays(taskId, groceries, "make me a grocery list", 1);
    await agentSays(taskId, groceries, "Starting the list.\nMore below.", {
      minute: 2,
    });
    await agentSays(taskId, groceries, "", { minute: 3 });
    const trip = await session(taskId, "Trip to Lisbon", 4);
    await userSays(taskId, trip, "plan a trip to lisbon", 4);
    // A session nobody has typed in is not a thread.
    await session(taskId, "Untitled chat", 5);

    const threads = await listThreads(taskId);

    expect(
      threads.map((thread) => ({
        createdAt: thread.createdAt,
        latest: thread.latest,
        replyCount: thread.replyCount,
        root: thread.root.parts.find((part) => part.type === "text")?.text,
        state: thread.state,
        title: thread.title,
        unread: thread.unread,
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

  it("lets the ask stand for a thread the agent has not named yet", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Untitled chat 3");
    await userSays(taskId, sessionId, "plan a trip to lisbon\nin october", 1);

    const [thread] = await listThreads(taskId);
    expect(thread?.title).toBe("plan a trip to lisbon");
  });

  it("does not count a reply that is still being written as new", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Working on it", {
      finished: false,
      minute: 2,
    });

    const [thread] = await listThreads(taskId);
    expect(thread?.unread).toBe(0);
  });

  it("puts one reply back among the unread when asked, and clears it again on seeing", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    await agentSays(taskId, sessionId, "One more thing.", { minute: 3 });
    await markThreadSeen(taskId, sessionId);

    await markThreadUnseen(taskId, sessionId);
    const [put] = await listThreads(taskId);
    expect(put?.unread).toBe(1);

    await markThreadSeen(taskId, sessionId);
    const [seen] = await listThreads(taskId);
    expect(seen?.unread).toBe(0);
  });

  it("clears the count once seen, and counts again from there", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Done.", { minute: 2 });

    await markThreadSeen(taskId, sessionId);
    await agentSays(taskId, sessionId, "One more thing.", { minute: 3 });

    const [thread] = await listThreads(taskId);
    expect(thread?.unread).toBe(1);
    // A reply still arriving is not settled, so seeing the thread now records
    // the reply before it.
    const streaming = await agentSays(taskId, sessionId, "Working on", {
      finished: false,
      minute: 4,
    });
    const seen = await threadById(taskId, sessionId);
    const settled = seen?.newestSettledMessageId;
    expect(settled).toBeDefined();
    expect(settled).not.toBe(streaming);
  });

  it("carries the topics a thread is tagged with, dropping ids that are not topics", async () => {
    const taskId = freshTask();
    const home = await createTopic(taskId, { name: "Home" });
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list");

    await setThreadTopics(taskId, sessionId, [home.id, "top_nothing"]);

    const [thread] = await listThreads(taskId);
    expect(thread?.topics).toEqual([home.id]);
  });

  it("puts a thread away and brings it back, without moving its stamp", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listThreads(taskId);
    expect(before?.archived).toBe(false);

    await archiveThread(taskId, sessionId);
    const [archived] = await listThreads(taskId);
    expect(archived?.archived).toBe(true);
    expect(archived?.updatedAt).toBe(before?.updatedAt);

    await unarchiveThread(taskId, sessionId);
    const [back] = await listThreads(taskId);
    expect(back?.archived).toBe(false);
  });

  it("stars a thread and takes the star off, without moving its stamp", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listThreads(taskId);
    expect(before?.starred).toBe(false);

    await setThreadStarred(taskId, sessionId, true);
    const [starred] = await listThreads(taskId);
    expect(starred?.starred).toBe(true);
    expect(starred?.updatedAt).toBe(before?.updatedAt);

    await setThreadStarred(taskId, sessionId, false);
    const [back] = await listThreads(taskId);
    expect(back?.starred).toBe(false);
  });

  it("takes the name the user typed, without moving its stamp", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries", 1);
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Here it is.", { minute: 2 });
    const [before] = await listThreads(taskId);

    await renameThread(taskId, sessionId, "Weekly shop");
    const [renamed] = await listThreads(taskId);
    expect(renamed?.title).toBe("Weekly shop");
    expect(renamed?.updatedAt).toBe(before?.updatedAt);
    const stored = await Store.getSession(sessionId, taskId);
    expect(stored._unsafeUnwrap().titleSettledAt).toBeInstanceOf(Date);
  });

  it("is working while a task filed from it runs, and says its step", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list");
    await setTaskState(taskDir(taskId), {
      taskThreads: { [child]: sessionId },
    });
    running.value = [
      {
        step: "Checking the pantry",
        taskId: child,
        thread: sessionId,
        title: "Grocery list",
        updatedAt: at(3).getTime(),
      },
    ];

    const [thread] = await listThreads(taskId);

    expect(thread?.state).toBe("working");
    expect(thread?.latest).toEqual({
      at: at(2).getTime(),
      kind: "step",
      text: "Checking the pantry",
    });
    expect(thread?.runningTasks).toEqual([
      { id: child, step: "Checking the pantry", title: "Grocery list" },
    ]);
  });

  it("waits, rather than works, while a task filed from it is stopped on an ask", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list");
    await setTaskState(taskDir(taskId), {
      taskThreads: { [child]: sessionId },
    });
    running.value = [
      {
        step: "Picking a store",
        taskId: child,
        thread: sessionId,
        title: "Grocery list",
        updatedAt: at(3).getTime(),
        waiting: "Which one?",
      },
    ];

    const [thread] = await listThreads(taskId);

    expect(thread?.state).toBe("waiting");
    expect(thread?.latest).toEqual({
      at: at(3).getTime(),
      kind: "question",
      text: "Which one?",
    });
    expect(thread?.runningTasks).toEqual([
      {
        id: child,
        step: "Picking a store",
        title: "Grocery list",
        waiting: "Which one?",
      },
    ]);

    // Another task still moving keeps the thread at work, and its step is
    // the one shown rather than the stalled task's.
    running.value = [
      ...running.value,
      {
        step: "Checking the pantry",
        taskId: TaskIdSchema.parse("pantry"),
        thread: sessionId,
        title: "Pantry",
        updatedAt: at(4).getTime(),
      },
    ];
    const [busy] = await listThreads(taskId);
    expect(busy?.state).toBe("working");
    expect(busy?.latest?.text).toBe("Checking the pantry");
  });

  it("is working while its own agent is alive, saying what it is doing", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "", {
      commands: ["task list"],
      minute: 2,
    });
    alive.value = new Set([sessionId]);

    const [thread] = await listThreads(taskId);

    expect(thread?.state).toBe("working");
    expect(thread?.latest?.kind).toBe("step");
    expect(thread?.latest?.text).toBe("Running a command");
  });

  // A message is written before the agent it starts is running, so a list
  // read in between must not call the thread idle and show its last reply.
  it("is working while a message it was just sent waits for its agent, for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const taskId = freshTask();
      const sessionId = await session(taskId, "Groceries", 1);
      await userSays(taskId, sessionId, "make me a grocery list", 1);
      await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
      await userSays(taskId, sessionId, "add eggs", 3);

      vi.setSystemTime(at(3).getTime() + 5000);
      const soon = await listThreads(taskId);
      expect(soon[0]?.state).toBe("working");

      vi.setSystemTime(at(3).getTime() + 60_000);
      const later = await listThreads(taskId);
      expect(later[0]?.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is working while a task filed from it has finished and its wake waits to be written", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(taskId, sessionId, "Starting the list.", { minute: 2 });
    const child = TaskIdSchema.parse("grocery-list-done");
    await setTaskState(taskDir(taskId), {
      taskThreads: { [child]: sessionId },
    });
    pendingWakes.value = new Set([child]);

    const [thread] = await listThreads(taskId);

    expect(thread?.state).toBe("working");
  });

  it("is waiting while its last turn ended on a question", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentAsks(taskId, sessionId);

    const [thread] = await listThreads(taskId);

    expect(thread?.state).toBe("waiting");
    expect(thread?.latest).toEqual({
      at: at(5).getTime(),
      kind: "question",
      text: "Which one?",
    });
  });

  it("is waiting, not working, while its own agent stands on the question it asked", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentAsks(taskId, sessionId);
    // The agent is alive to the machine: its turn is open on the tool call.
    alive.value = new Set([sessionId]);
    try {
      const [thread] = await listThreads(taskId);
      expect(thread?.state).toBe("waiting");
      expect(thread?.latest?.kind).toBe("question");
    } finally {
      alive.value = new Set();
    }
  });

  it("reads a reply that is only the files it handed over by what it wrote", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Compare");
    await userSays(taskId, sessionId, "compare the two quotes", 1);
    await agentSays(
      taskId,
      sessionId,
      "```files\n/mnt/Instrument/quotes/compared.html\n```",
      { minute: 2 },
    );

    const [thread] = await listThreads(taskId);
    expect(thread?.latest).toEqual({
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
    const [updated] = await listThreads(taskId);
    expect(updated?.latest?.text).toBe("Wrote 3 files: a.md, b.png, c.html");
    expect(updated?.replyCount).toBe(2);
  });

  it("reads what the thread made and used out of its replies", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(
      taskId,
      sessionId,
      "Here it is.\n\n```files\n/mnt/Instrument/groceries/list.md\n```",
      {
        commands: [
          'app call notion search \'{"query":"groceries"}\'',
          "open https://www.instacart.com/store",
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

    const [thread] = await listThreads(taskId);

    expect(thread?.holds).toEqual({
      apps: ["notion"],
      files: [
        "/mnt/Instrument/groceries/list.md",
        "/mnt/Instrument/groceries/prices.csv",
      ],
      sites: ["www.instacart.com"],
    });
  });
});
