import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { renameChat } from "../../lib/chat/chats";
import { grantFolder } from "../../lib/chat/grants";
import { recordAsk } from "../../lib/chat/asks";
import { ChatWrites } from "../../lib/chat-writes";
import { sessionOfChat } from "../../lib/record-folders";
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
let chatId = ChatIdSchema.parse("2026-09-26-conversation");
beforeAll(async () => {
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
  chatId = await chatFor(StoreId.newSessionId(), chatId);
});
const otherChatId = ChatIdSchema.parse("chat-other");

describe("chats.tasks", () => {
  const context: WorkspaceRPCContext = {
    workspaceConfig: getWorkspaceConfig(),
    // Listing never reaches the actor ref for a task it leaves out, so the
    // cast spares the test booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };

  it("refuses the window and a record that is no chat, since nothing lists every chat's tasks", async () => {
    for (const id of [WINDOW_ID, otherChatId]) {
      await expect(call(chats.tasks, { id }, { context })).rejects.toThrow(
        "That chat is not there any more.",
      );
    }
  });

  // Its turn ended with the card it ran into still up: no agent is at work,
  // but it waits on the person, and a Stop takes it off the card.
  it("lists a task waiting on a card as waiting, with a stop, though no agent is at work", async () => {
    setWorkspaceActorRef({
      getSnapshot: () => ({ context: { sessionRefsByChatId: new Map() } }),
    } as never);
    const pantry = await chatFor(StoreId.newSessionId());
    const task = await chatTaskFor(pantry, { title: "Count the jars" });
    await recordAsk(
      { chatId: pantry, sessionId: task },
      "folder",
      "/Users/me/Pantry",
    );

    expect(await call(chats.tasks, { id: pantry }, { context })).toEqual([
      expect.objectContaining({
        standing: {
          kind: "waiting",
          line: "Waiting for your OK to use “Pantry”",
        },
        stoppable: true,
        working: false,
      }),
    ]);
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
      { id: chatId },
      { context, signal: controller.signal },
    );
    expect((await live.next()).value).toEqual([]);

    await chatTaskFor(chatId, { title: "Child" });

    const next = await live.next();
    expect(
      next.done ? [] : next.value.map((task) => [task.handle, task.title]),
    ).toEqual([["t1", "Child"]]);
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });
});

describe("chats.live.info", () => {
  it("answers again when the chat is renamed", async () => {
    const context: WorkspaceRPCContext = {
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef: undefined as never,
    };
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("The chat has no session");
    }
    const now = new Date();
    await ChatWrites.saveSession(
      { createdAt: now, id: sessionId, title: "Untitled", updatedAt: now },
      chatId,
    );
    const controller = new AbortController();
    const live = await call(
      chats.live.info,
      { id: chatId },
      { context, signal: controller.signal },
    );
    const title = (next: IteratorResult<{ title: string }>) =>
      next.done ? undefined : next.value.title;
    expect(title(await live.next())).not.toBe("Lisbon trip");

    await renameChat(chatId, "Lisbon trip");

    expect(title(await live.next())).toBe("Lisbon trip");
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });
});

describe("chats.live.folders", () => {
  it("answers again when the chat is granted a folder", async () => {
    const context: WorkspaceRPCContext = {
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef: undefined as never,
    };
    const granted = fs.mkdtempSync(path.join(os.tmpdir(), "granted-"));
    const controller = new AbortController();
    const live = await call(
      chats.live.folders,
      { id: chatId },
      { context, signal: controller.signal },
    );
    const paths = (next: IteratorResult<Record<string, { path: string }>>) =>
      next.done ? [] : Object.values(next.value).map((folder) => folder.path);
    expect(paths(await live.next())).not.toContain(granted);

    await grantFolder({ chatId, path: granted, source: "card" });

    expect(paths(await live.next())).toContain(granted);
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });
});
