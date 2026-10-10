import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { setWorkspaceActorRef } from "../../lib/workspace-actor-ref";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { type WorkspaceRPCContext } from "../base";
import { chats } from "./chats";
import { ChatIdSchema } from "../../schemas/chat-id";

// A chat, and a record that is not one. The chat is a folder under a
// workspace root of this file's own.
let taskId = ChatIdSchema.parse("2026-09-26-conversation");
beforeAll(() => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(
      path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "chat-routes-")),
        "chats",
      ),
    ),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "chat-routes-")),
    ),
  });
  taskId = chatFor(StoreId.newSessionId(), taskId);
});
const otherTaskId = ChatIdSchema.parse("chat-other");

describe("chats.tasks", () => {
  const context: WorkspaceRPCContext = {
    workspaceConfig: getWorkspaceConfig(),
    // Listing never reaches the actor ref for a task it leaves out, so the
    // cast spares the test booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };

  it("refuses the window and a record that is no chat, since nothing lists every chat's tasks", async () => {
    for (const id of [WINDOW_ID, otherTaskId]) {
      await expect(call(chats.tasks, { id }, { context })).rejects.toThrow(
        "That chat is not there any more.",
      );
    }
  });
});

describe("chats.live.tasks", () => {
  it("answers again when the chat starts a task", async () => {
    // No agent is alive in a test; the list asks the machine whether one is.
    setWorkspaceActorRef({
      getSnapshot: () => ({ context: { sessionRefsByChatId: new Map() } }),
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

    await chatTaskFor(taskId, { title: "Child" });

    const next = await live.next();
    expect(
      next.done ? [] : next.value.map((task) => [task.handle, task.title]),
    ).toEqual([["t1", "Child"]]);
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });
});
