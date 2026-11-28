import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { CHAT_HIDDEN_TAB_CAP } from "../../schemas/chat-state";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { browserTargetOf } from "../../types";
import { getChatState, setChatState } from "../chat-record";
import { chatStatePath } from "../chat-dir-utils";
import { chatDir } from "../record-folders";
import { noteTabCommand, noteTabPages } from "../tab-activity";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { noteOpenedTab } from "./chat-tabs";
import { notePersonUsedTab, USE_MARK_RETRY_MS } from "./person-used-tabs";
import { closeTabsOverCap } from "./tab-cap";

/** The chat's page tabs as the window lists them, and the tabs it was asked to close. */
const window = vi.hoisted(() => ({
  closes: [] as string[],
  pages: [] as { id: string; targetId: string }[],
}));
vi.mock(import("./window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: ({ action }) => {
    if (action.kind === "close") {
      window.closes.push(action.tabId);
    }
    return Promise.resolve(
      action.kind === "list"
        ? {
            pages: window.pages.map((page) => ({
              ...page,
              title: "",
              url: "https://example.com/",
            })),
            requestId: "list",
          }
        : { requestId: "r" },
    );
  },
}));

let chatId: ChatId;
let root: string;
let captured: unknown[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "person-used-tabs-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("person-used-tabs-test")),
  );
  captured = [];
  window.closes = [];
  window.pages = [];
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
  it("marks a tab its chat's state kept before this launch, found by its opener", async () => {
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
    { case: "kept with its opener", openerOf: () => chatId },
    { case: "not kept yet", openerOf: () => undefined },
  ])(
    "marks a tab used before its entry was written, $case, as the entry is written",
    async ({ openerOf }) => {
      const id = newTab();
      const session = StoreId.newSessionId();

      notePersonUsedTab(id, openerOf);
      await settle();
      await noteOpenedTab(chatId, id, session);

      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id, openedIn: session, usedByPerson: true },
      ]);
    },
  );

  it("marks a tab on an HTML file by the tab's id, used in the page that draws it now", async () => {
    const tabId = newTab();
    const first = newTab();
    const next = newTab();
    await setChatState(chatDir(chatId), { openedTabs: [{ id: tabId }] });
    noteTabCommand(
      { tabId, targetId: first },
      { chatId, sessionId: StoreId.newSessionId() },
    );
    // The window lists the tab drawn by a new page once it walked to another file and back.
    noteTabPages([{ id: tabId, targetId: next }]);

    notePersonUsedTab(next, () => chatId);

    await vi.waitFor(async () => {
      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id: tabId, usedByPerson: true },
      ]);
    });
  });

  it("marks a tab whose page changed when the person used the new page before anything listed it, which the cap then keeps", async () => {
    const tabId = newTab();
    const first = newTab();
    const next = newTab();
    const others = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, () => ({
      id: newTab(),
    }));
    await setChatState(chatDir(chatId), {
      openedTabs: [{ id: tabId }, ...others],
    });
    noteTabCommand(
      { tabId, targetId: first },
      { chatId, sessionId: StoreId.newSessionId() },
    );
    // The tab walked to another file and back; nothing has listed it since.
    window.pages = [
      { id: tabId, targetId: next },
      ...others.map(({ id }) => ({ id, targetId: id })),
    ];

    notePersonUsedTab(next, () => chatId);
    await vi.waitFor(async () => {
      expect(
        (await getChatState(chatDir(chatId))).openedTabs[0]?.usedByPerson,
      ).toBe(true);
    });
    await closeTabsOverCap(chatId);

    expect(window.closes).not.toContain(tabId);
  });

  it("marks an earlier build's entry, kept by the page's id", async () => {
    const tabId = newTab();
    const page = newTab();
    await setChatState(chatDir(chatId), { openedTabs: [{ id: page }] });
    noteTabPages([{ id: tabId, targetId: page }]);

    notePersonUsedTab(page, () => chatId);

    await vi.waitFor(async () => {
      expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([
        { id: page, usedByPerson: true },
      ]);
    });
  });

  it("leaves a tab whose opener is no chat alone", async () => {
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
