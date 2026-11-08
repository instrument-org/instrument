import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TabLifetime } from "../../machines/window-browser";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { CHAT_HIDDEN_TAB_CAP, type OpenedTab } from "../../schemas/chat-state";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { type BrowserTargetId, browserTargetOf } from "../../types";
import { getChatState, setChatState } from "../chat-record";
import { chatDir } from "../record-folders";
import { noteTabCommand } from "../tab-activity";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { closeTabsOverCap, closeTaskTabs, closeTurnTabs } from "./tab-cap";

const lifetimes = vi.hoisted(() => new Map<string, TabLifetime>());
const closes = vi.hoisted(() => [] as string[]);
/** The tabs the window lists for the chat; undefined for no window to ask. */
const listed = vi.hoisted(() => ({ ids: undefined as string[] | undefined }));
/** The sessions with a turn running. */
const working = vi.hoisted(() => new Set<string>());

vi.mock(import("../../machines/window-browser"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabLifetime: (targetId: BrowserTargetId) => lifetimes.get(targetId),
}));
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: (_chatId: ChatId, sessionId?: StoreId.Session) =>
    sessionId !== undefined && working.has(sessionId),
}));
/** The chat's tasks, as its records list them. */
const tasks = vi.hoisted(
  () =>
    [] as { handle: string; id: string; stoppedBy?: "person"; title: string }[],
);
vi.mock(import("./children"), async (importOriginal) => ({
  ...(await importOriginal()),
  listChildTasks: () => Promise.resolve(tasks as never),
}));
vi.mock(import("./open-asks"), () => ({
  openAsks: () => Promise.resolve([]),
}));
vi.mock(import("./window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: ({ action }: { action: { kind: string; tabId?: string } }) => {
    if (action.kind === "close" && action.tabId) {
      closes.push(action.tabId);
    }
    if (action.kind === "list" && listed.ids) {
      return Promise.resolve({
        requestId: "list",
        tabs: listed.ids.map((id) => ({
          id,
          kind: "page" as const,
          title: "",
          url: "https://example.com/",
        })),
      });
    }
    return Promise.resolve(undefined);
  },
}));

let chatId: ChatId;
let root: string;
let personUsed: Set<string>;

beforeEach(async () => {
  lifetimes.clear();
  closes.length = 0;
  listed.ids = undefined;
  working.clear();
  tasks.length = 0;
  personUsed = new Set();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "tab-cap-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("tab-cap-test")),
  );
  const config = getWorkspaceConfig();
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      personInputAt: (id) => (personUsed.has(id) ? 1 : undefined),
    },
  });
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** A tab an agent opened, out of sight for `minutes`, or on screen with none. */
function openedTab(minutes: null | number): OpenedTab {
  const id = browserTargetOf(StoreId.newTabId());
  lifetimes.set(id, {
    drawn: minutes === null,
    hiddenForMs: minutes === null ? null : minutes * 60_000,
    unloadsInMs: minutes === null ? null : 0,
  });
  return { id };
}

describe("closeTabsOverCap", () => {
  it("leaves a chat at the cap alone", async () => {
    const tabs = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
      openedTab(i),
    );
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
  });

  it("closes the tab hidden longest past the cap, and keeps word of it for the chat", async () => {
    const oldest = openedTab(500);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      oldest,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([oldest.id]);
    const state = await getChatState(chatDir(chatId));
    expect(state.openedTabs.map((tab) => tab.id)).not.toContain(oldest.id);
    expect(state.closedTabs).toEqual([
      { id: oldest.id, reason: "tabCap", url: "" },
    ]);
  });

  it("never closes a tab on screen", async () => {
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      openedTab(null),
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
  });

  it("forgets a tab the person closed in the window, closing nothing for it", async () => {
    const closedByPerson = openedTab(900);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      closedByPerson,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });
    listed.ids = tabs
      .filter((tab) => tab !== closedByPerson)
      .map((tab) => tab.id);

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
    const state = await getChatState(chatDir(chatId));
    expect(state.closedTabs).toEqual([]);
    expect(state.openedTabs).toHaveLength(CHAT_HIDDEN_TAB_CAP);
  });

  it("closes an unloaded tab before any with a page", async () => {
    const unloaded: OpenedTab = { id: browserTargetOf(StoreId.newTabId()) };
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
        openedTab(i + 1000),
      ),
      unloaded,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([unloaded.id]);
  });
});

describe("closeTurnTabs", () => {
  it("closes the tabs agents opened that nobody is working in and the person never used", async () => {
    const idle = openedTab(1);
    const used = openedTab(1);
    personUsed.add(used.id);
    const onScreen = openedTab(null);
    await setChatState(chatDir(chatId), {
      openedTabs: [idle, used, onScreen],
    });

    await closeTurnTabs(chatId);

    expect(closes).toEqual([idle.id]);
    expect((await getChatState(chatDir(chatId))).closedTabs).toEqual([
      { id: idle.id, reason: "turnEnd", url: "" },
    ]);
  });

  it("keeps a tab a task worked in while the task can be sent on, and closes it with the task's stop, telling the task", async () => {
    const task = StoreId.newSessionId();
    tasks.push({ handle: "t1", id: task, title: "Cart" });
    const tab = openedTab(1);
    noteTabCommand(tab.id, { chatId, sessionId: task });
    await setChatState(chatDir(chatId), { openedTabs: [tab] });

    // Done, not working, and still to be sent on.
    await closeTurnTabs(chatId);
    expect(closes).toEqual([]);

    tasks[0] = { ...tasks[0]!, stoppedBy: "person" };
    await closeTaskTabs(chatId, task);
    expect(closes).toEqual([tab.id]);
    expect((await getChatState(chatDir(chatId))).closedTabs).toEqual([
      { id: tab.id, reason: "turnEnd", session: task, url: "" },
    ]);
  });

  it("keeps a tab a task opened, whoever worked in it since", async () => {
    const task = StoreId.newSessionId();
    tasks.push({ handle: "t1", id: task, title: "Cart" });
    const tab = { ...openedTab(1), openedIn: task };
    await setChatState(chatDir(chatId), { openedTabs: [tab] });

    await closeTurnTabs(chatId);

    expect(closes).toEqual([]);
  });

  it("notes a tab once when two closes race for it", async () => {
    const tab = openedTab(500);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      tab,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await Promise.all([closeTabsOverCap(chatId), closeTurnTabs(chatId)]);

    const { closedTabs } = await getChatState(chatDir(chatId));
    expect(closedTabs.filter((closed) => closed.id === tab.id)).toHaveLength(1);
  });
});
