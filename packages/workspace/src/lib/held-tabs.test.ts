import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { browserTargetOf } from "../types";
import { getChatState } from "./chat-record";
import {
  closePagesWithNoTab,
  heldTabs,
  returnTabsToChat,
  updateHeldTabs,
} from "./held-tabs";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { chatDir } from "./record-folders";

const CHAT_SESSION = StoreId.newSessionId();
const T1 = StoreId.newSessionId();
const T2 = StoreId.newSessionId();

vi.mock(import("./chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionRole: (_chatId: ChatId, sessionId: StoreId.Session) =>
    sessionId === CHAT_SESSION ? "chat" : "task",
}));

const tab = () => browserTargetOf(StoreId.newTabId());

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "held-tabs-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("held-tabs-test")),
  );
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("held tabs", () => {
  // One driver per tab: handing the chat's tab to a task takes it from the
  // chat, so two agents never act in one page at once.
  it("moves a tab to the session it is handed to", async () => {
    const page = tab();
    await updateHeldTabs(chatId, CHAT_SESSION, () => [
      { id: page, inWindow: true, openedBy: "task" },
    ]);

    await updateHeldTabs(chatId, T1, (held) => [
      ...held,
      { id: page, inWindow: true, openedBy: "handed" },
    ]);

    expect(await heldTabs(chatId, CHAT_SESSION)).toEqual([]);
    expect(await heldTabs(chatId, T1)).toEqual([
      { driver: T1, id: page, inWindow: true, openedBy: "handed" },
    ]);
  });

  it("gives a finished task's tabs back to the chat and no one else's", async () => {
    const handed = tab();
    const opened = tab();
    const others = tab();
    await updateHeldTabs(chatId, T1, () => [
      { id: handed, inWindow: true, openedBy: "handed" },
      { id: opened, inWindow: true, openedBy: "task" },
    ]);
    await updateHeldTabs(chatId, T2, () => [
      { id: others, inWindow: true, openedBy: "task" },
    ]);

    await returnTabsToChat(chatId, T1);

    expect(await heldTabs(chatId, CHAT_SESSION)).toEqual([
      { id: handed, inWindow: true, openedBy: "handed" },
      { id: opened, inWindow: true, openedBy: "task" },
    ]);
    expect(await heldTabs(chatId, T1)).toEqual([]);
    expect((await getChatState(chatDir(chatId))).browserTabs).toHaveLength(3);
  });

  it("closes the pages a session never sent anywhere as its turn ends, and keeps its tabs", async () => {
    const pending = tab();
    const shown = tab();
    await updateHeldTabs(chatId, T1, () => [
      { id: pending, inWindow: false, openedBy: "task" },
      { id: shown, inWindow: true, openedBy: "task" },
    ]);
    const closed: string[] = [];
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      browser: {
        ...config.browser,
        closeTarget: (targetId) => {
          closed.push(targetId);
          return Promise.resolve();
        },
      },
    });

    await closePagesWithNoTab(chatId, T1);

    expect(closed).toEqual([pending]);
    expect(await heldTabs(chatId, T1)).toEqual([
      { driver: T1, id: shown, inWindow: true, openedBy: "task" },
    ]);
  });
});
