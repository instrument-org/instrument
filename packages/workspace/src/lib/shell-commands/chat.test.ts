import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createTopic } from "../orchestrator/topics";
import { Store } from "../store";
import { createChatCommand } from "./chat";

vi.mock(import("../session-store-storage"));

// The list asks the machine which threads and tasks are at work; a test has
// no machine, so nothing is.
vi.mock(import("../orchestrator/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  orchestratorActivity: () => Promise.resolve({ running: [] }),
}));
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByTaskId: new Map() },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

// Task state and sessions are real files under the mock workspace, so a task
// id reused across runs would read the last run's threads.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`chat-${Date.now()}-${(counter += 1)}`),
  );

function run(taskId: TaskId, ...args: string[]) {
  return createChatCommand({ orchestratorTaskId: taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
}

/** A thread: a session, the user's opening message, and one reply. */
async function thread(
  taskId: TaskId,
  title: string,
  ask: string,
  reply?: string,
) {
  const sessionId = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title, updatedAt: new Date() },
    taskId,
  );
  const userId = StoreId.newMessageId();
  const user: SessionMessage.UserWithParts = {
    id: userId,
    metadata: { createdAt: new Date(), sessionId },
    parts: [
      {
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: userId,
          sessionId,
        },
        text: ask,
        type: "text",
      },
    ],
    role: "user",
  };
  await Store.saveMessageWithParts(user, taskId);
  if (reply) {
    const replyId = StoreId.newMessageId();
    const assistant: SessionMessage.AssistantWithParts = {
      id: replyId,
      metadata: {
        createdAt: new Date(),
        finishedAt: new Date(),
        finishReason: "stop",
        modelId: "glm-5.3-flash",
        providerId: "openai-compatible",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: new Date(),
            id: StoreId.newPartId(),
            messageId: replyId,
            sessionId,
          },
          text: reply,
          type: "text",
        },
      ],
      role: "assistant",
    };
    await Store.saveMessageWithParts(assistant, taskId);
  }
  return sessionId;
}

describe("chat threads", () => {
  it("lists each thread with its state, title, topics and latest line", async () => {
    const taskId = freshTask();
    await createTopic(taskId, { name: "Home" });
    const groceries = await thread(
      taskId,
      "Groceries for the week",
      "make me a grocery list",
      "Starting the list.",
    );
    const lisbon = await thread(taskId, "Trip to Lisbon", "plan a trip");
    await run(taskId, "tag", "groceries", "home");

    const result = await run(taskId, "threads");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${groceries.slice(0, 8)}  idle  "Groceries for the week"  #Home  Starting the list.\n${lisbon.slice(0, 8)}  idle  "Trip to Lisbon"  nothing yet\n`,
    );

    const filtered = await run(taskId, "threads", "--topic", "home");
    expect(filtered.stdout).toContain("Groceries");
    expect(filtered.stdout).not.toContain("Lisbon");
  });
});

describe("chat read", () => {
  it("reads a thread by words from its title", async () => {
    const taskId = freshTask();
    await thread(
      taskId,
      "Groceries for the week",
      "make me a grocery list",
      "Starting the list.",
    );
    await thread(taskId, "Trip to Lisbon", "plan a trip");

    const result = await run(taskId, "read", "lisbon");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(
      /^\S+ {2}"Trip to Lisbon"\nuser: plan a trip\n$/,
    );
  });

  it("lists the matches when the words fit more than one thread", async () => {
    const taskId = freshTask();
    await thread(taskId, "Trip to Lisbon", "plan a trip");
    await thread(taskId, "Trip to Porto", "plan another trip");

    const result = await run(taskId, "read", "trip");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("matches 2 threads");
    expect(result.stderr).toContain("Trip to Lisbon");
    expect(result.stderr).toContain("Trip to Porto");
  });
});

describe("chat search", () => {
  it("finds a line across every thread", async () => {
    const taskId = freshTask();
    await thread(taskId, "Groceries", "make me a grocery list", "Added Zevia.");
    await thread(taskId, "Trip to Lisbon", "plan a trip");

    const result = await run(taskId, "search", "zevia");

    expect(result.stdout).toMatch(
      /^\S+ {2}"Groceries" {2}you: Added Zevia\.\n$/,
    );
  });
});

describe("chat tag", () => {
  it("refuses a topic that does not exist and names the ones that do", async () => {
    const taskId = freshTask();
    await createTopic(taskId, { name: "Home" });
    await thread(taskId, "Groceries", "make me a grocery list");

    const result = await run(taskId, "tag", "groceries", "work");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'chat tag: no topic called "work". The topics: #Home.\n',
    );
  });

  it("files the thread under the topic", async () => {
    const taskId = freshTask();
    const home = await createTopic(taskId, { name: "Home" });
    const sessionId = await thread(
      taskId,
      "Groceries",
      "make me a grocery list",
    );

    const result = await run(taskId, "tag", sessionId.slice(0, 8), "Home");

    expect(result.stdout).toBe('Filed "Groceries" under #Home.\n');
    const session = await Store.getSession(sessionId, taskId);
    expect(session._unsafeUnwrap().topics).toEqual([home.id]);
  });
});

describe("chat topics", () => {
  it("names the topics in use", async () => {
    const taskId = freshTask();
    await createTopic(taskId, {
      about: "the house",
      emoji: "🏠",
      name: "Home",
    });

    const result = await run(taskId, "topics");

    expect(result.stdout).toBe("#Home  🏠  the house\n");
  });
});
