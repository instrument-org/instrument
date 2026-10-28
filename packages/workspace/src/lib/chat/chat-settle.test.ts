import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor, writtenIn } from "../../test/helpers/chat-task";
import { setChatModel } from "../chat-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { sessionOfChat } from "../record-folders";
import { setWorkspaceActorRef } from "../workspace-actor-ref";
import {
  chatById,
  markChatRead,
  settleIsNews,
  startChatSettle,
  startChatUnreadOnSettle,
} from "./chats";
import { noteTasksInterruptedByQuit, startChatWake, wakeAskers } from "./wake";
import { hasWakeOnItsWay } from "./wake-queue";

// A wake gives up on the chat's model after about two minutes of retries;
// here the waits between them pass at once.
vi.mock(import("node:timers/promises"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    setTimeout: <T = void>(_delay?: number, value?: T) =>
      original.setTimeout<T>(0, value),
  };
});

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: vi.fn(() => Promise.resolve({ ok: true, value: {} } as never)),
}));

const sent: unknown[] = [];
/** The sessions with a turn running, which a case sets. */
const alive = new Set<StoreId.Session>();
// The machine records what it was sent, and a message it is sent starts a
// turn in its session at once, as `addMessage` spawns one; which sessions
// have a turn running is `alive`.
const workspaceRef = {
  getSnapshot: () => ({
    context: {
      sessionRefsByChatId: {
        get: () =>
          [...alive].map((sessionId) => ({
            getSnapshot: () => ({
              context: { sessionId },
              tags: new Set(["agent.alive"]),
            }),
          })),
      },
    },
  }),
  send: (event: { type: string; value: { sessionId: StoreId.Session } }) => {
    sent.push(event);
    if (event.type === "addMessage") {
      alive.add(event.value.sessionId);
    }
  },
} as unknown as WorkspaceActorRef;

/** What `chat.settled` said, by chat. */
const settles: { by?: string; id: string; sessionId: string }[] = [];

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-settle-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  setWorkspaceActorRef(workspaceRef);
  startChatSettle();
  startChatWake(workspaceRef);
  startChatUnreadOnSettle();
  publisher.subscribe("chat.settled", (settle) => {
    settles.push(settle);
  });
});

afterEach(() => {
  alive.clear();
});

function settlesOf(chatId: ChatId) {
  return settles.filter((settle) => settle.id === chatId);
}

/** Long enough for a check under way to have published. */
async function settledDown() {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** A chat someone has written in, on a model, with one task. */
async function chatWithTask() {
  const chatId = await chatFor(StoreId.newSessionId());
  const written = await setChatModel(
    chatId,
    AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  );
  if (written.isErr()) {
    throw written.error;
  }
  await writtenIn(chatId);
  const taskSession = await chatTaskFor(chatId, { title: "Audit the vault" });
  return { chatId, taskSession };
}

function turnsStarted(chatId: ChatId) {
  return sent.filter(
    (event) =>
      (event as { type: string; value: { id: string } }).type ===
        "addMessage" &&
      (event as { value: { id: string } }).value.id === chatId,
  );
}

describe("a chat whose wake never starts its turn", () => {
  // The task's news is written into the chat, and then the chat's model
  // cannot be found after every retry: no turn starts, so no turn of the
  // chat's ends, and only the wake giving up says the chat is at rest.
  it("settles once the wake gives up, and is marked unread", async () => {
    const { chatId, taskSession } = await chatWithTask();
    vi.mocked(fetchModel).mockImplementation(() =>
      Promise.resolve({ error: new Error("not listed"), ok: false } as never),
    );

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(() => {
      expect(hasWakeOnItsWay(chatId)).toBe(true);
    });
    await vi.waitFor(() => {
      expect(hasWakeOnItsWay(chatId)).toBe(false);
    }, 5000);
    vi.mocked(fetchModel).mockReset();

    expect(turnsStarted(chatId)).toEqual([]);
    await vi.waitFor(async () => {
      expect((await chatById(chatId))?.unread).toBe(true);
    });
    expect(settlesOf(chatId)).toHaveLength(1);
  });
});

describe("settleIsNews", () => {
  it.each([
    [undefined, true],
    ["agent", true],
    ["app", true],
    ["person", false],
  ] as const)("a settle by %s is news: %s", (by, expected) => {
    expect(settleIsNews(by ? { by } : {})).toBe(expected);
  });
});

describe("a chat settling", () => {
  // The chat's reply is a step on the way while its task works, and the
  // task's end, which the chat itself stopped, is what leaves it at rest.
  it("waits for the task that outlives the chat's turn, then settles once", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("expected the chat's session");
    }
    alive.add(taskSession);

    publisher.publish("session.done", { id: chatId, sessionId: own });
    await settledDown();
    expect(settlesOf(chatId)).toEqual([]);

    alive.delete(taskSession);
    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "agent", wakesChat: false },
      sessionId: taskSession,
    });
    await vi.waitFor(() => {
      expect(settlesOf(chatId)).toEqual([
        { by: "agent", id: chatId, sessionId: own },
      ]);
    });
    await settledDown();
    expect(settlesOf(chatId)).toHaveLength(1);
    expect((await chatById(chatId))?.unread).toBe(true);
  });

  // The person's Stop settles the chat like any end, and says whose it was,
  // so what hears it can leave the chat as it was.
  it("names the person when their Stop settled it, and leaves the chat read", async () => {
    const { chatId } = await chatWithTask();
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("expected the chat's session");
    }

    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "person", wakesChat: false },
      sessionId: own,
    });
    await vi.waitFor(() => {
      expect(settlesOf(chatId)).toEqual([
        { by: "person", id: chatId, sessionId: own },
      ]);
    });
    await settledDown();
    expect((await chatById(chatId))?.unread).toBe(false);
  });

  it("does not settle while a task's finish is on its way to the chat", async () => {
    const { chatId, taskSession } = await chatWithTask();
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("expected the chat's session");
    }

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(() => {
      expect(turnsStarted(chatId)).toHaveLength(1);
    }, 5000);
    // The wake started the chat's turn; until that turn ends nothing settles.
    await settledDown();
    expect(settlesOf(chatId)).toEqual([]);

    alive.delete(own);
    publisher.publish("session.done", { id: chatId, sessionId: own });
    await vi.waitFor(() => {
      expect(settlesOf(chatId)).toEqual([{ id: chatId, sessionId: own }]);
    });
  });
});

/** A chat with a task that has settled once already, and been read since. */
async function settledChatWithTask() {
  const { chatId, taskSession } = await chatWithTask();
  const own = sessionOfChat(chatId);
  if (!own) {
    throw new Error("expected the chat's session");
  }
  publisher.publish("session.done", { id: chatId, sessionId: own });
  await vi.waitFor(() => {
    expect(settlesOf(chatId)).toHaveLength(1);
  });
  await markChatRead(chatId);
  return { chatId, own, taskSession };
}

describe("a chat that settles with nothing new in it", () => {
  // The task asked on a card and the person answered, but the chat's model
  // cannot be found: the note lands in the task's session, and the chat
  // shows nothing it did not show when it last settled.
  it("is not settled again by a wake to its task that gave up", async () => {
    const { chatId, taskSession } = await settledChatWithTask();
    vi.mocked(fetchModel).mockImplementation(() =>
      Promise.resolve({ error: new Error("not listed"), ok: false } as never),
    );

    await expect(
      wakeAskers(
        {
          data: {
            answer: "allowed",
            kind: "folder",
            target: "/Users/me/Pantry",
          },
          type: "data-permissionAnswer",
        },
        workspaceRef,
        chatId,
        [taskSession],
      ),
    ).rejects.toThrow("not listed");
    vi.mocked(fetchModel).mockReset();
    await settledDown();

    expect(settlesOf(chatId)).toHaveLength(1);
    expect((await chatById(chatId))?.unread).toBe(false);
  });

  // The quit writes the chat a note naming the task it cut off, and stops
  // the task as the app's: nothing anyone did, and nothing to tell them.
  it("is not settled by the app's quit", async () => {
    const { chatId, taskSession } = await settledChatWithTask();
    alive.add(taskSession);

    await noteTasksInterruptedByQuit([{ chatId, sessionId: taskSession }]);
    alive.delete(taskSession);
    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "app", wakesChat: false },
      sessionId: taskSession,
    });
    await settledDown();

    expect(settlesOf(chatId)).toHaveLength(1);
    expect((await chatById(chatId))?.unread).toBe(false);
  });
});
