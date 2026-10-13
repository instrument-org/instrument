import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  killSessionBackgroundProcesses,
  listBackgroundProcesses,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../../lib/background-processes";
import { updateChatSettings } from "../../lib/chat-settings";
import { startJobWake } from "../../lib/chat/job-wake";
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
import { chatTaskFor } from "../../test/helpers/chat-task";
import { session } from "./session";

vi.mock(import("../../lib/session-store-storage"));

// Whether a session has a turn running is the workspace machine's to say,
// which a test has none of: none is, so a wake would start one.
vi.mock(import("../../lib/chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: vi.fn(() => false),
}));

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
});

afterEach(async () => {
  await Promise.all(
    owners.splice(0).map((id) => killSessionBackgroundProcesses(id)),
  );
});

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

/** A command that outlived its call and runs until something stops it. */
function running(owner: { chatId: ChatId; sessionId: StoreId.Session }) {
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command: "sleep 300",
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
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
  it("ends the processes a task has running when the person stops it, before its turn, and starts no turn", async () => {
    const { chatId, task } = await chatWithTask();
    const job = running({ chatId, sessionId: task });
    const sentBefore = sent.length;

    await call(
      session.stop,
      { id: chatId, sessionId: task },
      { context: context() },
    );

    expect(
      listBackgroundProcesses(task).find((process) => process.id === job),
    ).toMatchObject({ status: "killed", stoppedBy: "user" });
    expect(sent.slice(sentBefore)).toEqual([
      expect.objectContaining({
        type: "stopSessions",
        value: expect.objectContaining({ sessionId: task }),
      }),
    ]);
    // Past the debounce a wake for the job's ending would wait out.
    await new Promise((resolve) => setTimeout(resolve, 2000));
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
