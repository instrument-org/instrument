import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createTopic } from "../chat/topics";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createChatCommand } from "./chat";

vi.mock(import("../session-store-storage"));

// The list asks the machine which chats and tasks are at work; a test has
// no machine, so nothing is.
vi.mock(import("../chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
}));
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: new Map() },
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
    ChatIdSchema.parse(`window-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-root-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
  });
  return chatId;
};

/** A chat: its record and session, the user's opening message, and one reply. */
async function chat(title: string, ask: string, reply?: string) {
  const sessionId = StoreId.newSessionId();
  const chatId = chatFor(sessionId);
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title, updatedAt: new Date() },
    chatId,
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
  await Store.saveMessageWithParts(user, chatId);
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
    await Store.saveMessageWithParts(assistant, chatId);
  }
  return { chatId, sessionId };
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
    await freshChat();
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
      `${groceries.chatId}  idle  "Groceries for the week"  #Home  Starting the list.\n${lisbon.chatId}  working  "Trip to Lisbon"  nothing yet\n`,
    );

    const filtered = await run("list", "--topic", "home");
    expect(filtered.stdout).toContain("Groceries");
    expect(filtered.stdout).not.toContain("Lisbon");
  });
});

describe("chat read", () => {
  it("reads a chat by words from its title", async () => {
    await freshChat();
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
    await freshChat();
    await chat("Trip to Lisbon", "plan a trip");
    await chat("Trip to Porto", "plan another trip");

    const result = await run("read", "trip");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("matches 2 chats");
    expect(result.stderr).toContain("Trip to Lisbon");
    expect(result.stderr).toContain("Trip to Porto");
  });

  it("reads a chat by its whole id when another chat's id begins with it", async () => {
    await freshChat();
    const id = (await chat("Weather page", "make me a weather page")).chatId;
    const sessionId = StoreId.newSessionId();
    await Store.saveSession(
      {
        createdAt: new Date(),
        id: sessionId,
        title: "Weather page",
        updatedAt: new Date(),
      },
      chatFor(sessionId, ChatIdSchema.parse(`${id}-2`)),
    );

    const result = await run("read", id);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${id}  "Weather page"\nuser: make me a weather page\n`,
    );
  });
});

describe("chat read by an older name", () => {
  // Older transcripts, and the links in them, name a chat by its session.
  it.each([
    ["a whole session", (sessionId: string) => sessionId],
    ["the start of one", (sessionId: string) => sessionId.slice(0, 20)],
  ])("reads a chat named by %s", async (_case, nameOf) => {
    await freshChat();
    const { chatId, sessionId } = await chat("Trip to Lisbon", "plan a trip");

    const result = await run("read", nameOf(sessionId));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${chatId}  "Trip to Lisbon"\nuser: plan a trip\n`,
    );
  });
});

describe("chat search", () => {
  it("finds a line across every chat", async () => {
    await freshChat();
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
    await freshChat();
    await createTopic({ name: "Home" });
    await chat("Groceries", "make me a grocery list");

    const result = await run("tag", "groceries", "work");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'chat tag: no topic called "work". The topics: #Home.\n',
    );
  });

  it("files the chat under the topic", async () => {
    await freshChat();
    const home = await createTopic({ name: "Home" });
    const { chatId, sessionId } = await chat(
      "Groceries",
      "make me a grocery list",
    );

    const result = await run("tag", chatId, "Home");

    expect(result.stdout).toBe('Filed "Groceries" under #Home.\n');
    const session = await Store.getSession(sessionId, chatFor(sessionId));
    expect(session._unsafeUnwrap().topics).toEqual([home.id]);
  });
});

describe("chat topics", () => {
  it("names the topics in use", async () => {
    await freshChat();
    await createTopic({
      about: "the house",
      emoji: "🏠",
      name: "Home",
    });

    const result = await run("topics");

    expect(result.stdout).toBe("#Home  🏠  the house\n");
  });
});
