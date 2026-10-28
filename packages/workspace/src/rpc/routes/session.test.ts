import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  killSessionBackgroundProcesses,
  listBackgroundProcesses,
  processStopsSettled,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../../lib/background-processes";
import { setChatModel } from "../../lib/chat-settings";
import { isWorking } from "../../lib/chat/activity";
import { chatById } from "../../lib/chat/chats";
import { childTask } from "../../lib/chat/children";
import { startJobWake } from "../../lib/chat/job-wake";
import { hasWakeOnItsWay } from "../../lib/chat/wake-queue";
import { taskStanding } from "../../lib/chat/standing";
import { startChatWake } from "../../lib/chat/wake";
import { recordAsk } from "../../lib/chat/asks";
import { openAsks } from "../../lib/chat/open-asks";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { sessionOfChat } from "../../lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor, writtenIn } from "../../test/helpers/chat-task";
import { publisher } from "../publisher";
import { permissions } from "./permissions";
import { session } from "./session";

// Whether a session has a turn running is the workspace machine's to say,
// which a test has none of: none is, so a wake would start one, and no task
// is at work.
vi.mock(import("../../lib/chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: vi.fn(() => Promise.resolve({ running: [] })),
  isWorking: vi.fn(() => false),
}));

// Watched, so a case can let a process go once the task's note waits for it.
vi.mock(import("../../lib/background-processes"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    processStopsSettled: vi.fn(original.processStopsSettled),
  };
});

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
}));

const sent: { type: string; value: { sessionId?: string } }[] = [];
const workspaceRef = {
  send: (event: { type: string; value: { sessionId?: string } }) => {
    sent.push(event);
  },
} as unknown as WorkspaceActorRef;
const context = () => ({
  workspaceConfig: getWorkspaceConfig(),
  workspaceRef,
});

const owners: StoreId.Session[] = [];

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-routes-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  startJobWake(workspaceRef);
  startChatWake(workspaceRef);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    owners.splice(0).map((id) => killSessionBackgroundProcesses(id)),
  );
});

/** The task events of the notes written into `chatId`'s own session. */
async function notesIn(chatId: ChatId) {
  const messages = await ChatReads.transcript({
    chatId,
    sessionId: sessionOfChat(chatId) ?? StoreId.newSessionId(),
  });
  return messages
    ._unsafeUnwrap()
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "data-taskEvent" ? part.data.events : [],
    );
}

/** The sessions a wake was sent to since the `before`th event, in order. */
function wokenSince(before: number) {
  return sent
    .slice(before)
    .filter((event) => event.type === "addMessage")
    .map((event) => event.value.sessionId);
}

/** A chat someone has written in, with one task. */
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
  const own = sessionOfChat(chatId);
  if (!own) {
    throw new Error("expected the chat's session");
  }
  await writtenIn(chatId);
  const task = await chatTaskFor(chatId, { title: "Sleep 300 seconds" });
  owners.push(own, task);
  return { chatId, own, task };
}

/**
 * A command that outlived its call and runs until something stops it, going
 * once `gone` settles after it is told to, or at once.
 */
function running(
  owner: { chatId: ChatId; sessionId: StoreId.Session },
  gone: Promise<void> = Promise.resolve(),
) {
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command: "sleep 300",
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          void gone.then(() => {
            reject(new Error("aborted"));
          });
        });
      }),
  });
  const promoted = promoteBackgroundProcess({ handle, ...owner });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return promoted.info.id;
}

/** A turn of `sessionId`'s own that ended on words. */
async function said(chatId: ChatId, sessionId: StoreId.Session, text: string) {
  const createdAt = new Date();
  const messageId = StoreId.newMessageId();
  const written = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: {
        createdAt,
        finishReason: "stop",
        modelId: "glm-5.3-flash",
        providerId: "openai-compatible",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text,
          type: "text",
        },
      ],
      role: "assistant",
    },
    chatId,
  );
  if (written.isErr()) {
    throw written.error;
  }
}

/** Where a task with no agent at work stands. */
function standingOf(chatId: ChatId, sessionId: StoreId.Session) {
  return taskStanding({ chatId, isRunning: false, sessionId });
}

// A task whose turn ended with the card it ran into still up waits on the
// person: their answer wakes it, and their Stop ends the wait.
describe("a task waiting on a card", () => {
  it("is woken by the answer, and then finishes like any other turn", async () => {
    const { chatId, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await said(chatId, task, "I need the Pantry folder to go on.");
    expect(await standingOf(chatId, task)).toEqual({
      kind: "waiting",
      line: "Waiting for your OK to use “Pantry”",
    });

    const sentBefore = sent.length;
    const [card] = await openAsks(chatId);
    await call(
      permissions.answer,
      { askId: card?.id ?? "", decision: "allowed", id: chatId },
      { context: context() },
    );
    expect(wokenSince(sentBefore)).toEqual([task]);
    expect(await openAsks(chatId)).toEqual([]);

    // The turn the answer started ends on words of its own.
    await said(chatId, task, "The Pantry has 12 jars of jam.");
    publisher.publish("session.done", { id: chatId, sessionId: task });
    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    }, 5000);
    expect((await notesIn(chatId))[0]).toMatchObject({
      status: "done",
      summary: "The Pantry has 12 jars of jam.",
    });
    expect((await notesIn(chatId))[0]).not.toHaveProperty("needs");
    expect(await standingOf(chatId, task)).toEqual({
      kind: "done",
      line: "The Pantry has 12 jars of jam.",
    });
  });

  it("leaves its part of the card when the person stops it, and reads as stopped", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    await said(chatId, task, "I need the Pantry folder to go on.");
    const sentBefore = sent.length;

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );

    expect(
      (await openAsks(chatId)).map((card) =>
        card.askers.map((asker) => asker.sessionId),
      ),
    ).toEqual([[own]]);
    await vi.waitFor(async () => {
      expect((await childTask(chatId, task))?.stoppedBy).toBe("person");
    }, 5000);
    expect(await standingOf(chatId, task)).toEqual({
      kind: "done",
      line: "I need the Pantry folder to go on.",
    });
    // Its chat hears it was stopped with the person's next message, as it
    // does of a task stopped mid-turn, and nothing is woken.
    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    }, 5000);
    expect((await notesIn(chatId))[0]).toMatchObject({
      sessionId: task,
      stoppedBy: "person",
    });
    expect((await notesIn(chatId))[0]).not.toHaveProperty("needs");
    expect(wokenSince(sentBefore)).toEqual([]);
  });
});

describe("session.stop", () => {
  it("ends the processes a task has running when the person stops it, and starts no turn", async () => {
    const { chatId, task } = await chatWithTask();
    const job = running({ chatId, sessionId: task });
    const sentBefore = sent.length;
    const published = vi.spyOn(publisher, "publish");

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );

    await vi.waitFor(() => {
      expect(
        listBackgroundProcesses(task).find((process) => process.id === job),
      ).toMatchObject({ status: "killed", stoppedBy: "user" });
    });
    expect(sent.slice(sentBefore)).toEqual([
      expect.objectContaining({
        type: "stopSessions",
        value: expect.objectContaining({ sessionId: task }),
      }),
    ]);
    // A stop somebody asked for is no news: the job's ending settles nothing
    // a wake would wait out.
    expect(
      published.mock.calls.filter(
        ([topic]) => topic === "backgroundProcess.settled",
      ),
    ).toEqual([]);
    expect(hasWakeOnItsWay(chatId)).toBe(false);
  });

  // A process can take seconds to go, which the person's Stop does not wait
  // out; the task's note does, so it names nothing as still running.
  it("stops a task's turn before what it runs has gone, and its note waits for that", async () => {
    const { chatId, task } = await chatWithTask();
    let letGo = () => {};
    const job = running(
      { chatId, sessionId: task },
      new Promise((resolve) => {
        letGo = resolve;
      }),
    );

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );
    expect(sent.at(-1)).toMatchObject({
      type: "stopSessions",
      value: { sessionId: task },
    });
    expect(
      listBackgroundProcesses(task).find((process) => process.id === job)
        ?.status,
    ).toBe("running");

    // The task's turn ends while the process is still going, which goes only
    // once the note waits for it.
    const waits = vi.mocked(processStopsSettled);
    const settled = waits.getMockImplementation();
    waits.mockImplementationOnce((sessionId) => {
      letGo();
      return settled?.(sessionId) ?? Promise.resolve();
    });
    publisher.publish("session.done", {
      id: chatId,
      notice: { by: "person", wakesChat: true },
      sessionId: task,
    });
    await vi.waitFor(async () => {
      expect(await notesIn(chatId)).toHaveLength(1);
    });
    expect((await notesIn(chatId))[0]).not.toHaveProperty("running");
  });

  // A card left open after its session stopped would keep the chat waiting,
  // and answering it would start that session again. The chat's own card
  // stays, and a later ask of its own for the same thing is a card of its
  // own rather than folded into the one that went.
  it("closes the cards a stopped task raised, waking nothing", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "app", "Notes");
    const sentBefore = sent.length;

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");

    expect(
      (await openAsks(chatId)).map((ask) => ({
        asker: ask.askers.map((asker) =>
          asker.sessionId === own ? "chat" : "task",
        ),
        target: ask.kind === "question" ? ask.question : ask.target,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "asker": [
            "chat",
          ],
          "target": "Notes",
        },
        {
          "asker": [
            "chat",
          ],
          "target": "/Users/me/Pantry",
        },
      ]
    `);
    expect(
      sent.slice(sentBefore).filter((event) => event.type === "addMessage"),
    ).toEqual([]);
  });

  // An ask of the chat's that joined a task's card is the chat's as much as
  // the task's: stopping the task leaves the card up for the chat, and its
  // answer reaches the chat alone rather than starting the stopped task.
  it("keeps a card the chat also asked on when the task is stopped, and its answer wakes only the chat", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );
    const cards = await openAsks(chatId);
    expect(
      cards.map((card) => card.askers.map((asker) => asker.sessionId)),
    ).toEqual([[own]]);

    const sentBefore = sent.length;
    await call(
      permissions.answer,
      { askId: cards[0]?.id ?? "", decision: "allowed", id: chatId },
      { context: context() },
    );
    expect(wokenSince(sentBefore)).toEqual([own]);
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("closes a card once the last session that asked on it is stopped, waking nothing", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const sentBefore = sent.length;

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );
    await call(
      session.stop,
      { id: chatId, sessionId: own },
      { context: context() },
    );

    expect(await openAsks(chatId)).toEqual([]);
    expect(wokenSince(sentBefore)).toEqual([]);
  });

  // A Stop before the turn began leaves only the message no turn took up,
  // and the chat still says the person stopped it.
  it.each([
    { running: true, state: "stopped" },
    { running: false, state: "idle" },
  ])(
    "says the chat was stopped once the person stops its own turn (turn running: $running)",
    async ({ running: turnRunning, state }) => {
      const { chatId, own } = await chatWithTask();
      const messageId = StoreId.newMessageId();
      const createdAt = new Date();
      await ChatWrites.saveSession(
        { createdAt, id: own, title: "Documents" },
        chatId,
      );
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt, sessionId: own },
          parts: [
            {
              metadata: {
                createdAt,
                id: StoreId.newPartId(),
                messageId,
                sessionId: own,
              },
              text: "What's in my Documents?",
              type: "text",
            },
          ],
          role: "user",
        },
        chatId,
      );
      vi.mocked(isWorking).mockReturnValueOnce(turnRunning);

      await call(
        session.stop,
        { id: chatId, sessionId: own },
        { context: context() },
      );

      expect((await chatById(chatId))?.state).toBe(state);
    },
  );

  it("leaves the chat's own processes running when the person stops its turn", async () => {
    const { chatId, own } = await chatWithTask();
    const job = running({ chatId, sessionId: own });

    await call(
      session.stop,
      { id: chatId, sessionId: own },
      { context: context() },
    );

    expect(
      listBackgroundProcesses(own).find((process) => process.id === job),
    ).toMatchObject({ status: "running" });
  });
});
