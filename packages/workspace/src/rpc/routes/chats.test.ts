import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { forgetRecord, placeTask } from "../../lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { type WorkspaceRPCContext } from "../base";
import { publisher } from "../publisher";
import { announceChatRemoved, chatChanges, chats } from "./chats";
import { ChatIdSchema } from "../../schemas/chat-id";

// A chat, a task that is not one, and a task the chat started. The chat is a
// folder under a workspace root of this file's own.
let taskId = ChatIdSchema.parse("2026-09-26-conversation");
beforeAll(() => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "chat-routes-")),
    ),
  });
  taskId = chatFor(StoreId.newSessionId(), taskId);
  fs.mkdirSync(placeTask(childTaskId, taskId), { recursive: true });
});
const otherTaskId = TaskIdSchema.parse("chat-other");
const childTaskId = TaskIdSchema.parse("chat-child");

/** A child's bash call as it lands, in the state a tool part reaches. */
const toolPart = (
  state: "input-available" | "input-streaming",
): SessionMessagePart.Type => {
  const base = {
    input: { command: "ls", explanation: "Listing", yieldMs: 30_000 },
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    toolCallId: "call_1",
    type: "tool-bash" as const,
  };
  return state === "input-available"
    ? { ...base, state: "input-available" }
    : { ...base, state: "input-streaming" };
};

/** Whether the stream fires within a tick, so a silence can be asserted too. */
async function fired(
  pending: Promise<IteratorResult<null, void>>,
): Promise<boolean> {
  return Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 50);
    }),
  ]);
}

describe("chatChanges", () => {
  it("fires when the workspace's apps change, since a chat's holds name only the apps the workspace has", async () => {
    const controller = new AbortController();
    const changes = chatChanges(controller.signal);
    const next = changes.next();
    publisher.publish("app.updated", null);
    expect(await fired(next)).toBe(true);
    controller.abort();
    await changes.return();
  });

  it.each([
    ["session.tagsChanged", { id: taskId, sessionId: StoreId.newSessionId() }],
    ["session.done", { id: taskId, sessionId: StoreId.newSessionId() }],
  ] as const)(
    "fires on %s, since a chat's state is read off its agent's actor rather than the store",
    async (topic, payload) => {
      const controller = new AbortController();
      const changes = chatChanges(controller.signal);
      const next = changes.next();
      publisher.publish(topic, payload);
      expect(await fired(next)).toBe(true);
      controller.abort();
      await changes.return();
    },
  );

  it("fires when a chat is deleted, though the index forgot it before anyone was told", async () => {
    const sessionId = StoreId.newSessionId();
    const deleted = chatFor(sessionId);
    const controller = new AbortController();
    const changes = chatChanges(controller.signal);
    const next = changes.next();
    forgetRecord(deleted);
    announceChatRemoved({ chatTasks: [], id: deleted, sessionId });
    expect(await fired(next)).toBe(true);
    controller.abort();
    await changes.return();
  });

  it.each([
    ["session.updated", { id: otherTaskId, sessionId: StoreId.newSessionId() }],
    [
      "session.tagsChanged",
      { id: otherTaskId, sessionId: StoreId.newSessionId() },
    ],
  ] as const)(
    "stays quiet on %s from a task that is not a chat",
    async (topic, payload) => {
      const controller = new AbortController();
      const changes = chatChanges(controller.signal);
      const next = changes.next();
      publisher.publish(topic, payload);
      expect(await fired(next)).toBe(false);
      controller.abort();
      await changes.return();
    },
  );

  it.each([
    [
      "fires when a task filed from it starts a call",
      childTaskId,
      "input-available",
      true,
    ],
    [
      "stays quiet while a child's call is still streaming in",
      childTaskId,
      "input-streaming",
      false,
    ],
    [
      "stays quiet on a call in a task it did not file",
      otherTaskId,
      "input-available",
      false,
    ],
  ] as const)("%s", async (_name, id, state, expected) => {
    const controller = new AbortController();
    const changes = chatChanges(controller.signal);
    const next = changes.next();
    publisher.publish("part.updated", { id, part: toolPart(state) });
    expect(await fired(next)).toBe(expected);
    controller.abort();
    await changes.return();
  });
});

describe("chats.tasks", () => {
  const context: WorkspaceRPCContext = {
    workspaceConfig: getWorkspaceConfig(),
    // Listing never reaches the actor ref for a task it leaves out, so the
    // cast spares the test booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };

  it("refuses the window and a task, since nothing lists every chat's tasks", async () => {
    for (const id of [WINDOW_ID, otherTaskId, childTaskId]) {
      await expect(call(chats.tasks, { id }, { context })).rejects.toThrow(
        "That chat is not there any more.",
      );
    }
  });

  it("leaves out a task with no settings, and makes nothing inside it", async () => {
    expect(await call(chats.tasks, { id: taskId }, { context })).toEqual([]);
    const childDir = path.join(
      getWorkspaceConfig().rootDir,
      "chats",
      taskId,
      "tasks",
      childTaskId,
    );
    expect(fs.readdirSync(childDir)).toEqual([]);
  });
});
