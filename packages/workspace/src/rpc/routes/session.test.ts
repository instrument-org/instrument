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
import { updateChatSettings } from "../../lib/chat-settings";
import { hasPendingJobWake, startJobWake } from "../../lib/chat/job-wake";
import { startChatWake } from "../../lib/chat/wake";
import { openAsks, recordAsk } from "../../lib/permissions/asks";
import { sessionOfChat } from "../../lib/record-folders";
import { Store } from "../../lib/store";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { publisher } from "../publisher";
import { session } from "./session";

vi.mock(import("../../lib/session-store-storage"));

// Whether a session has a turn running is the workspace machine's to say,
// which a test has none of: none is, so a wake would start one.
vi.mock(import("../../lib/chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
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
  const messages = await Store.getMessagesWithParts({
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

/** A chat someone has written in, with one task. */
async function chatWithTask() {
  const chatId = chatFor(StoreId.newSessionId());
  const written = await updateChatSettings(chatId, {
    modelURI: AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  });
  if (written.isErr()) {
    throw written.error;
  }
  const own = sessionOfChat(chatId);
  if (!own) {
    throw new Error("expected the chat's session");
  }
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
    expect(hasPendingJobWake(chatId)).toBe(false);
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
      notice: { by: "user", wakesChat: true },
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
        asker: ask.sessionId === own ? "chat" : "task",
        target: ask.target,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "asker": "chat",
          "target": "Notes",
        },
        {
          "asker": "chat",
          "target": "/Users/me/Pantry",
        },
      ]
    `);
    expect(
      sent.slice(sentBefore).filter((event) => event.type === "addMessage"),
    ).toEqual([]);
  });

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
