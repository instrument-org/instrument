import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { placeTask } from "../../lib/record-folders";
import { updateTaskSettings } from "../../lib/task-settings";
import { setWorkspaceActorRef } from "../../lib/workspace-actor-ref";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { type WorkspaceRPCContext } from "../base";
import { chats } from "./chats";
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

describe("chats.live.tasks", () => {
  it("answers again when a task the chat filed changes", async () => {
    // No agent is alive in a test; the list asks the machine whether one is.
    setWorkspaceActorRef({
      getSnapshot: () => ({ context: { sessionRefsByTaskId: new Map() } }),
    } as never);
    const context: WorkspaceRPCContext = {
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef: undefined as never,
    };
    const controller = new AbortController();
    const live = await call(
      chats.live.tasks,
      { id: taskId },
      { context, signal: controller.signal },
    );
    expect((await live.next()).value).toEqual([]);

    expect(
      (await updateTaskSettings(childTaskId, { name: "Child" })).isOk(),
    ).toBe(true);

    const next = await live.next();
    expect(next.done ? [] : next.value.map((task) => task.title)).toEqual([
      "Child",
    ]);
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });
});
