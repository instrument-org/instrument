import { call } from "@orpc/server";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CHATS_FOLDER_NAME } from "../../constants";
import { ensureChat } from "../../lib/chat/chat-records";
import { chatIsWorking, renameChat } from "../../lib/chat/chats";
import { retitleChat, startChatRetitle } from "../../lib/chat/retitle";
import { chatFolderNames } from "../../lib/chat-folders/own-folder";
import { sessionOfChat } from "../../lib/record-folders";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { StoreId } from "../../schemas/store-id";
import { type WorkspaceRPCContext } from "../base";
import { publisher } from "../publisher";
import { chats } from "./chats";

vi.mock(import("../../lib/chat/chats"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatIsWorking: vi.fn(),
}));

vi.mock(import("../../lib/chat/retitle"), async (importOriginal) => ({
  ...(await importOriginal()),
  retitleChat: vi.fn(),
}));

const context: WorkspaceRPCContext = {
  workspaceConfig: getWorkspaceConfig(),
  // Naming a chat never reaches the actor ref, so the cast spares the test
  // booting a workspace machine it would not use.
  workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
};

function folderOf(chatId: string): string | undefined {
  return chatFolderNames(getWorkspaceConfig().workspaceMachineDir).get(chatId);
}

function folderNames(): Promise<string[]> {
  return fs.readdir(path.join(getWorkspaceConfig().rootDir, CHATS_FOLDER_NAME));
}

beforeAll(() => {
  startChatRetitle();
});

beforeEach(() => {
  vi.mocked(chatIsWorking).mockResolvedValue(false);
});

describe("a chat's folder following its title", () => {
  it("catches up on a rename made while the chat worked once its turn settles", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Plan a dinner");
    vi.mocked(chatIsWorking).mockResolvedValue(true);

    await call(
      chats.rename,
      { id: chatId, title: "Dinner for six" },
      { context },
    );
    expect(folderOf(chatId)).toBe("Plan a dinner");

    vi.mocked(chatIsWorking).mockResolvedValue(false);
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("the chat has no session");
    }
    publisher.publish("session.done", { id: chatId, sessionId });

    await vi.waitFor(() => {
      expect(folderOf(chatId)).toBe("Dinner for six");
    });
    expect(await folderNames()).toContain("Dinner for six");
  });

  it("tells a live reader of the chat's folder where it moved", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Say hi");
    const controller = new AbortController();
    const live = await call(
      chats.live.ownFolder,
      { id: chatId },
      { context, signal: controller.signal },
    );
    const named = (next: IteratorResult<null | string>) =>
      next.done || next.value === null ? undefined : path.basename(next.value);
    expect(named(await live.next())).toBe("Say hi");

    await call(chats.rename, { id: chatId, title: "Greetings" }, { context });

    expect(named(await live.next())).toBe("Greetings");
    controller.abort();
    await live.return?.(undefined).catch(() => undefined);
  });

  it("follows a name the user asked the model for", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Find a flight");
    vi.mocked(retitleChat).mockImplementation(async ({ id }) => {
      await renameChat(id, "Flights to Lisbon");
      return "Flights to Lisbon";
    });

    expect(await call(chats.retitle, { id: chatId }, { context })).toEqual({
      title: "Flights to Lisbon",
    });

    expect(folderOf(chatId)).toBe("Flights to Lisbon");
    expect(await folderNames()).toContain("Flights to Lisbon");
  });
});
