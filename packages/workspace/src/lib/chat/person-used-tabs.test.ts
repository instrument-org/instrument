import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { browserTargetOf } from "../../types";
import { getChatState, setChatState } from "../chat-record";
import { chatStatePath } from "../chat-dir-utils";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { noteOpenedTab } from "./chat-tabs";
import { notePersonUsedTab, USE_MARK_RETRY_MS } from "./person-used-tabs";

let chatId: ChatId;
let root: string;
let captured: unknown[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "person-used-tabs-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("person-used-tabs-test")),
  );
  captured = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    captureException: (error: unknown) => {
      captured.push(error);
    },
  });
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(root, { force: true, recursive: true });
});

const newTab = () => browserTargetOf(StoreId.newTabId());

/** Lets the fire-and-forget write land. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await getChatState(chatDir(chatId));
  }
}

describe("notePersonUsedTab", () => {
  it("marks a tab its chat's state kept before this launch, found by its group", async () => {
    const id = newTab();
    const other = newTab();
    await setChatState(chatDir(chatId), {
      openedTabs: [{ id }, { id: other }],
    });

    notePersonUsedTab(id, () => chatId);

    await vi.waitFor(async () => {
      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id, usedByPerson: true },
        { id: other },
      ]);
    });
  });

  it.each([
    { group: "a chat's group", groupOf: () => chatId },
    { group: "no group yet", groupOf: () => undefined },
  ])(
    "marks a tab used before its entry was written, in $group, as the entry is written",
    async ({ groupOf }) => {
      const id = newTab();
      const session = StoreId.newSessionId();

      notePersonUsedTab(id, groupOf);
      await settle();
      await noteOpenedTab(chatId, id, session);

      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id, openedIn: session, usedByPerson: true },
      ]);
    },
  );

  it("leaves a tab in a group that is no chat's alone", async () => {
    const id = newTab();
    const session = StoreId.newSessionId();

    notePersonUsedTab(id, () => "-");
    await settle();
    await noteOpenedTab(chatId, id, session);

    expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
      { id, openedIn: session },
    ]);
  });

  it("keeps the mark when the tab is noted as opened again", async () => {
    const id = newTab();
    const session = StoreId.newSessionId();
    await noteOpenedTab(chatId, id, session);

    notePersonUsedTab(id, () => chatId);
    await vi.waitFor(async () => {
      expect(
        (await getChatState(chatDir(chatId))).openedTabs[0]?.usedByPerson,
      ).toBe(true);
    });
    await noteOpenedTab(chatId, id, session);

    expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
      { id, openedIn: session, usedByPerson: true },
    ]);
  });

  it("tries a failed write again only after a pause, reporting it once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const id = newTab();
    const statePath = chatStatePath(
      chatDir(chatId),
      getWorkspaceConfig().deviceId,
    );
    // A folder where the state file goes, which no write gets past.
    await fs.mkdir(statePath);

    notePersonUsedTab(id, () => chatId);
    await vi.waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    for (let i = 0; i < 60; i++) {
      notePersonUsedTab(id, () => chatId);
    }
    await settle();
    expect(captured).toHaveLength(1);

    await fs.rm(statePath, { recursive: true });
    await setChatState(chatDir(chatId), { openedTabs: [{ id }] });
    vi.setSystemTime(Date.now() + USE_MARK_RETRY_MS + 1);
    notePersonUsedTab(id, () => chatId);

    await vi.waitFor(async () => {
      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id, usedByPerson: true },
      ]);
    });
    expect(captured).toHaveLength(1);
  });
});
