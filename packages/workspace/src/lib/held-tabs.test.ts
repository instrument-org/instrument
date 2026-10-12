import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { WINDOW_ID } from "../schemas/window-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { encodeBrowserTargetId } from "../types";
import { getChatState } from "./chat-record";
import { heldTabs, returnTabsToChat, updateHeldTabs } from "./held-tabs";
import { chatDir } from "./record-folders";

const CHAT_SESSION = StoreId.newSessionId();
const T1 = StoreId.newSessionId();
const T2 = StoreId.newSessionId();

vi.mock(import("./chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  isTaskSession: (_chatId: ChatId, sessionId: StoreId.Session) =>
    sessionId !== CHAT_SESSION,
}));

const tab = () => encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId());

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
      { id: page, openedBy: "task" },
    ]);

    await updateHeldTabs(chatId, T1, (held) => [
      ...held,
      { id: page, openedBy: "handed" },
    ]);

    expect(await heldTabs(chatId, CHAT_SESSION)).toEqual([]);
    expect(await heldTabs(chatId, T1)).toEqual([
      { driver: T1, id: page, openedBy: "handed" },
    ]);
  });

  it("gives a finished task's tabs back to the chat and no one else's", async () => {
    const handed = tab();
    const opened = tab();
    const others = tab();
    await updateHeldTabs(chatId, T1, () => [
      { id: handed, openedBy: "handed" },
      { id: opened, openedBy: "task" },
    ]);
    await updateHeldTabs(chatId, T2, () => [{ id: others, openedBy: "task" }]);

    await returnTabsToChat(chatId, T1);

    expect(await heldTabs(chatId, CHAT_SESSION)).toEqual([
      { id: handed, openedBy: "handed" },
      { id: opened, openedBy: "task" },
    ]);
    expect(await heldTabs(chatId, T1)).toEqual([]);
    expect((await getChatState(chatDir(chatId))).browserTabs).toHaveLength(3);
  });
});
