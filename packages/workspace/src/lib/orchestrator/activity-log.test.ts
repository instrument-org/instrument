import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { listActivityLog } from "./activity-log";

vi.mock(import("../session-store-storage"));

// Sessions are real files under the mock workspace, so a task id reused
// across runs would read the last run's threads.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`activity-${Date.now()}-${(counter += 1)}`),
  );

const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 12, minute));

const CHILD = TaskIdSchema.parse("grocery-list");

/** The three calls that stop a turn to ask the user, as the model makes them. */
type Ask =
  | {
      input: { access: "read-only" | "read-write"; reason: string };
      type: "tool-request_folder";
    }
  | { input: { choices: string[]; question: string }; type: "tool-choose" }
  | { input: { reason: string; slug: string }; type: "tool-connect_app" };

/** A turn that ended on a question to the user. */
async function agentAsks(
  taskId: TaskId,
  sessionId: StoreId.Session,
  part: Ask,
  minute: number,
) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at(minute),
      finishedAt: at(minute),
      finishReason: "tool-calls",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      {
        ...part,
        metadata: partMetadata({ messageId, sessionId }),
        state: "input-available",
        toolCallId: `call_${StoreId.newPartId()}`,
      },
    ],
    role: "assistant",
  };
  const saved = await Store.saveMessageWithParts(message, taskId);
  expect(saved.isOk()).toBe(true);
  return messageId;
}

/** A finished reply: its words, and the tool calls it made before them. */
async function agentSays(
  taskId: TaskId,
  sessionId: StoreId.Session,
  text: string,
  {
    calls = [],
    finished = true,
    minute = 0,
  }: {
    calls?: { command: string; output?: string }[];
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
      finishReason: "stop",
      ...(finished ? { finishedAt: at(minute) } : {}),
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      ...calls.map(({ command, output = "" }) => ({
        input: { command, explanation: "Running a command", yieldMs: 1000 },
        metadata: { ...partMetadata(ids), endedAt: at(minute) },
        output: {
          command,
          commands: [command],
          durationMs: 0,
          exitCode: 0,
          omittedBytes: 0,
          output,
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

async function session(
  taskId: TaskId,
  title: string,
  { minute = 0, topics }: { minute?: number; topics?: string[] } = {},
) {
  const id = StoreId.newSessionId();
  await Store.saveSession(
    {
      createdAt: at(minute),
      id,
      title,
      ...(topics ? { topics } : {}),
      updatedAt: at(minute),
    },
    taskId,
  );
  return id;
}

/** The note a task's end writes into the thread: a user message with nothing typed. */
async function taskEnds(
  taskId: TaskId,
  sessionId: StoreId.Session,
  status: "done" | "error" | "overdue",
  minute: number,
  files?: string[],
) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt: at(minute), sessionId },
    parts: [
      {
        data: {
          events: [
            {
              ...(files ? { files } : {}),
              status,
              taskId: CHILD,
              title: "Grocery list",
            },
          ],
        },
        metadata: partMetadata({ messageId, sessionId }),
        type: "data-taskEvent",
      },
    ],
    role: "user",
  };
  const saved = await Store.saveMessageWithParts(message, taskId);
  expect(saved.isOk()).toBe(true);
  return messageId;
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

describe("listActivityLog", () => {
  it("lists what happened across the threads newest first, each entry naming its thread", async () => {
    const taskId = freshTask();
    const groceries = await session(taskId, "Groceries for the week", {
      minute: 1,
      topics: ["top_home"],
    });
    await userSays(
      taskId,
      groceries,
      "make me a grocery list\nfor the week",
      1,
    );
    await agentSays(taskId, groceries, "Starting the list.\nMore below.", {
      minute: 2,
    });
    const trip = await session(taskId, "Trip to Lisbon", { minute: 3 });
    await userSays(taskId, trip, "plan a trip to lisbon", 3);
    // A reply still being written is not one yet.
    await agentSays(taskId, trip, "Looking", { finished: false, minute: 4 });

    const entries = await listActivityLog(taskId);

    expect(
      entries.map((entry) => ({
        at: entry.at,
        kind: entry.kind,
        text: entry.text,
        thread: entry.thread,
      })),
    ).toEqual([
      {
        at: at(3).getTime(),
        kind: "asked",
        text: "plan a trip to lisbon",
        thread: { id: trip, title: "Trip to Lisbon", topics: [] },
      },
      {
        at: at(2).getTime(),
        kind: "replied",
        text: "Starting the list.",
        thread: {
          id: groceries,
          title: "Groceries for the week",
          topics: ["top_home"],
        },
      },
      {
        at: at(1).getTime(),
        kind: "asked",
        text: "make me a grocery list",
        thread: {
          id: groceries,
          title: "Groceries for the week",
          topics: ["top_home"],
        },
      },
    ]);
  });

  it("reads one entry per thing done: tasks, files, apps, sites, and questions", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    await agentSays(
      taskId,
      sessionId,
      "Here it is.\n\n```files\n/mnt/Instrument/groceries/list.md\n/mnt/Instrument/groceries/prices.csv\n```",
      {
        calls: [
          {
            command: 'task new "Grocery list" --folder /mnt/Instrument',
            output: `Created ${CHILD} ("Grocery list"). It is running now.`,
          },
          // Not created: the command printed an error instead.
          { command: "task new Nothing", output: "No folder named that." },
          { command: 'app call notion search \'{"query":"groceries"}\'' },
          { command: "open https://www.instacart.com/store" },
        ],
        minute: 2,
      },
    );
    await taskEnds(taskId, sessionId, "overdue", 3);
    await taskEnds(taskId, sessionId, "error", 4);
    await taskEnds(taskId, sessionId, "done", 5, [
      "/mnt/Instrument/groceries/list.md",
    ]);
    await agentAsks(
      taskId,
      sessionId,
      {
        input: { choices: ["Yes", "No"], question: "Add snacks too?" },
        type: "tool-choose",
      },
      6,
    );
    await agentAsks(
      taskId,
      sessionId,
      {
        input: { reason: "So I can read your Notion pages.", slug: "notion" },
        type: "tool-connect_app",
      },
      7,
    );
    await agentAsks(
      taskId,
      sessionId,
      {
        input: { access: "read-only", reason: "Your Desktop, for the list." },
        type: "tool-request_folder",
      },
      8,
    );

    const entries = await listActivityLog(taskId);

    expect(
      entries.map((entry) => [
        entry.kind,
        entry.text,
        entry.marks ?? null,
        entry.taskId ?? null,
      ]),
    ).toEqual([
      ["askedYou", "Your Desktop, for the list.", null, null],
      ["askedYou", "So I can read your Notion pages.", null, null],
      ["askedYou", "Add snacks too?", null, null],
      [
        "taskFinished",
        "Grocery list",
        { files: ["/mnt/Instrument/groceries/list.md"] },
        CHILD,
      ],
      ["taskFailed", "Grocery list", null, CHILD],
      ["taskOverdue", "Grocery list", null, CHILD],
      [
        "madeFile",
        "prices.csv",
        { files: ["/mnt/Instrument/groceries/prices.csv"] },
        null,
      ],
      [
        "madeFile",
        "list.md",
        { files: ["/mnt/Instrument/groceries/list.md"] },
        null,
      ],
      [
        "openedPage",
        "www.instacart.com",
        { sites: ["www.instacart.com"] },
        null,
      ],
      ["usedApp", "notion", { apps: ["notion"] }, null],
      ["startedTask", "Grocery list", null, CHILD],
      ["replied", "Here it is.", null, null],
      ["asked", "make me a grocery list", null, null],
    ]);
  });

  it("gives every entry an id that holds still across reads", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "make me a grocery list", 1);
    const reply = await agentSays(
      taskId,
      sessionId,
      "Two files.\n\n```files\n/mnt/a.md\n/mnt/b.md\n```",
      { minute: 2 },
    );

    const first = await listActivityLog(taskId);
    const second = await listActivityLog(taskId);

    expect(first.map((entry) => entry.id)).toEqual(
      second.map((entry) => entry.id),
    );
    expect(
      first.filter((entry) => entry.kind !== "asked").map((entry) => entry.id),
    ).toEqual([
      `${sessionId}:${reply}:madeFile:1`,
      `${sessionId}:${reply}:madeFile`,
      `${sessionId}:${reply}:replied`,
    ]);
  });

  it("stops at the limit, keeping the newest", async () => {
    const taskId = freshTask();
    const sessionId = await session(taskId, "Groceries");
    await userSays(taskId, sessionId, "one", 1);
    await agentSays(taskId, sessionId, "two", { minute: 2 });
    await userSays(taskId, sessionId, "three", 3);

    const entries = await listActivityLog(taskId, { limit: 2 });

    expect(entries.map((entry) => entry.text)).toEqual(["three", "two"]);
  });
});
