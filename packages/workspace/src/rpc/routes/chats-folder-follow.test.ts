import { call } from "@orpc/server";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CHATS_FOLDER_NAME } from "../../constants";
import { ensureChat } from "../../lib/chat/chat-records";
import { chatIsWorking, renameChat } from "../../lib/chat/chats";
import {
  retitleChat,
  startChatRetitle,
  TITLE_TRIES,
} from "../../lib/chat/retitle";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { chatFolderNames } from "../../lib/chat-folders/own-folder";
import { sessionOfChat } from "../../lib/record-folders";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
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
    publisher.publish("chat.settled", { id: chatId, sessionId });

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

  it("tells a window where the folder was and where it is", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Draw a map");
    const chatsDir = path.join(getWorkspaceConfig().rootDir, CHATS_FOLDER_NAME);
    const controller = new AbortController();
    const moves = await call(chats.events.folderMoved, undefined, {
      context,
      signal: controller.signal,
    });

    // Listening before the rename, as a window is.
    const moved = moves.next();
    await call(chats.rename, { id: chatId, title: "Old maps" }, { context });

    expect((await moved).value).toEqual({
      from: path.join(chatsDir, "Draw a map"),
      id: chatId,
      to: path.join(chatsDir, "Old maps"),
    });
    controller.abort();
    await moves.return?.(undefined).catch(() => undefined);
  });

  it("follows a name the user asked the model for", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Find a flight");
    vi.mocked(retitleChat).mockImplementation(async ({ id }) => {
      await renameChat(id, "Flights to Lisbon");
      return "Flights to Lisbon";
    });

    expect(await call(chats.retitle, { id: chatId }, { context })).toEqual({
      listed: null,
      title: "Flights to Lisbon",
    });

    expect(folderOf(chatId)).toBe("Flights to Lisbon");
    expect(await folderNames()).toContain("Flights to Lisbon");
  });
});

describe("a chat with nothing to name", () => {
  async function says(
    chatId: ChatId,
    sessionId: StoreId.Session,
    text: string,
  ) {
    const messageId = StoreId.newMessageId();
    const createdAt = new Date();
    (
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt, sessionId },
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
          role: "user",
        },
        chatId,
      )
    )._unsafeUnwrap();
  }

  async function settledAt(chatId: ChatId, sessionId: StoreId.Session) {
    return (await ChatReads.session({ chatId, sessionId }))._unsafeUnwrap()
      .titleSettledAt;
  }

  // Without a reply there is nothing to name it from, which is the answer
  // the titler gives a greeting, without a model call.
  it("keeps its opening words once the person has sent their third message", async () => {
    const sessionId = StoreId.newSessionId();
    const chatId = await ensureChat(sessionId, "hi");
    const asks = ["hi", "hey", "test"];
    expect(asks).toHaveLength(TITLE_TRIES);
    for (const said of asks.slice(0, -1)) {
      await says(chatId, sessionId, said);
      publisher.publish("chat.settled", { id: chatId, sessionId });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await settledAt(chatId, sessionId)).toBeUndefined();

    await says(chatId, sessionId, asks.at(-1) ?? "");
    publisher.publish("chat.settled", { id: chatId, sessionId });
    await vi.waitFor(async () => {
      expect(await settledAt(chatId, sessionId)).toBeDefined();
    });
  });
});
