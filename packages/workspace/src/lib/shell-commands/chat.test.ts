import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createTopic } from "../orchestrator/topics";
import { Store } from "../store";
import { updateTaskSettings } from "../task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createChatCommand } from "./chat";

vi.mock(import("../session-store-storage"));

// The list asks the machine which chats and tasks are at work; a test has
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
// id reused across runs would read the last run's chats.
let counter = 0;
/**
 * The window's record, in a workspace of its own: chats, topics and the
 * window's record all live under the root, so each test gets one.
 */
const freshTask = async () => {
  const taskId = createMockTaskConfig(
    TaskIdSchema.parse(`window-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-root-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    tasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
  });
  const made = await updateTaskSettings(taskId, {
    kind: "orchestrator",
    name: "Instrument",
  });
  expect(made.isOk()).toBe(true);
  return taskId;
};

/** A chat: a session, the user's opening message, and one reply. */
async function chat(title: string, ask: string, reply?: string) {
  const sessionId = StoreId.newSessionId();
  const taskId = chatFor(sessionId);
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

function run(...args: string[]) {
  return createChatCommand().execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
}

describe("chat list", () => {
  it("lists each chat with its state, title, topics and latest line", async () => {
    await freshTask();
    await createTopic({ name: "Home" });
    const groceries = await chat(
      "Groceries for the week",
      "make me a grocery list",
      "Starting the list.",
    );
    const lisbon = await chat("Trip to Lisbon", "plan a trip");
    await run("tag", "groceries", "home");

    const result = await run("list");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${groceries}  idle  "Groceries for the week"  #Home  Starting the list.\n${lisbon}  working  "Trip to Lisbon"  nothing yet\n`,
    );

    const filtered = await run("list", "--topic", "home");
    expect(filtered.stdout).toContain("Groceries");
    expect(filtered.stdout).not.toContain("Lisbon");
  });
});

describe("chat read", () => {
  it("reads a chat by words from its title", async () => {
    await freshTask();
    await chat(
      "Groceries for the week",
      "make me a grocery list",
      "Starting the list.",
    );
    await chat("Trip to Lisbon", "plan a trip");

    const result = await run("read", "lisbon");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(
      /^\S+ {2}"Trip to Lisbon"\nuser: plan a trip\n$/,
    );
  });

  it("lists the matches when the words fit more than one chat", async () => {
    await freshTask();
    await chat("Trip to Lisbon", "plan a trip");
    await chat("Trip to Porto", "plan another trip");

    const result = await run("read", "trip");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("matches 2 chats");
    expect(result.stderr).toContain("Trip to Lisbon");
    expect(result.stderr).toContain("Trip to Porto");
  });
});

describe("chat search", () => {
  it("finds a line across every chat", async () => {
    await freshTask();
    await chat("Groceries", "make me a grocery list", "Added Zevia.");
    await chat("Trip to Lisbon", "plan a trip");

    const result = await run("search", "zevia");

    expect(result.stdout).toMatch(
      /^\S+ {2}"Groceries" {2}you: Added Zevia\.\n$/,
    );
  });
});

describe("chat tag", () => {
  it("refuses a topic that does not exist and names the ones that do", async () => {
    await freshTask();
    await createTopic({ name: "Home" });
    await chat("Groceries", "make me a grocery list");

    const result = await run("tag", "groceries", "work");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'chat tag: no topic called "work". The topics: #Home.\n',
    );
  });

  it("files the chat under the topic", async () => {
    await freshTask();
    const home = await createTopic({ name: "Home" });
    const sessionId = await chat("Groceries", "make me a grocery list");

    const result = await run("tag", sessionId.slice(0, 8), "Home");

    expect(result.stdout).toBe('Filed "Groceries" under #Home.\n');
    const session = await Store.getSession(sessionId, chatFor(sessionId));
    expect(session._unsafeUnwrap().topics).toEqual([home.id]);
  });
});

describe("chat topics", () => {
  it("names the topics in use", async () => {
    await freshTask();
    await createTopic({
      about: "the house",
      emoji: "🏠",
      name: "Home",
    });

    const result = await run("topics");

    expect(result.stdout).toBe("#Home  🏠  the house\n");
  });
});
