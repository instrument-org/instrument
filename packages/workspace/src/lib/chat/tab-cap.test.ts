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
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { getChatState, setChatState } from "../chat-record";
import { chatDir } from "../record-folders";
import { closeChatTabs, closeTabsOverCap } from "./tab-cap";

const lifetimes = vi.hoisted(() => new Map<string, TabLifetime>());
const closes = vi.hoisted(() => [] as string[]);
/** The tabs the window lists for the chat; undefined for no window to ask. */
const listed = vi.hoisted(() => ({
  /** The tab each page draws, by the page's id, where the tab's own id is another: a tab on an HTML file. */
  drawnFor: new Map<string, string>(),
  ids: undefined as string[] | undefined,
  /** Tabs of the chat's group with no page: a file tab on a file of another kind than HTML. */
  pageless: [] as string[],
  /** Tabs up on their side of the chat's group while the window shows it. */
  up: new Set<string>(),
  /** Tabs the person moved to a tab group of their own. */
  elsewhere: [] as string[],
}));

vi.mock(import("../../machines/window-browser"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabLifetime: (targetId: BrowserTargetId) => lifetimes.get(targetId),
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
        pages: listed.ids.map((id) => ({
          id: listed.drawnFor.get(id) ?? id,
          targetId: id,
          title: "",
          url: "https://example.com/",
        })),
        windows: [
          {
            groups: [
              {
                focused: 0,
                group: { id: "group" },
                sides: [
                  {
                    tabs: [
                      {
                        address: "",
                        id: "tab_chat",
                        isThisChat: true,
                        kind: "chat" as const,
                        title: "",
                      },
                      ...[
                        ...listed.ids.map(
                          (id) => listed.drawnFor.get(id) ?? id,
                        ),
                        ...listed.pageless,
                      ].map((id) => ({
                        address: "",
                        id,
                        ...(listed.up.has(id) ? { isUp: true } : {}),
                        kind: "file" as const,
                        title: "",
                      })),
                    ],
                  },
                ],
                title: "",
              },
              {
                focused: 0,
                group: { id: "group:mine" },
                sides: [
                  {
                    tabs: listed.elsewhere.map((id) => ({
                      address: "",
                      id,
                      kind: "file" as const,
                      title: "",
                    })),
                  },
                ],
                title: "",
              },
            ],
          },
        ],
      });
    }
    return Promise.resolve(undefined);
  },
}));

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  lifetimes.clear();
  closes.length = 0;
  listed.ids = undefined;
  listed.drawnFor.clear();
  listed.pageless = [];
  listed.up.clear();
  listed.elsewhere = [];
  root = await fs.mkdtemp(path.join(os.tmpdir(), "tab-cap-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("tab-cap-test")),
  );
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** A tab an agent opened, out of sight for `minutes`, or on screen with none. */
function openedTab(minutes: null | number, used = false): OpenedTab {
  const id = browserTargetOf(StoreId.newTabId());
  lifetimes.set(id, {
    drawn: minutes === null,
    hiddenForMs: minutes === null ? null : minutes * 60_000,
    unloadsInMs: minutes === null ? null : 0,
  });
  return used ? { id, usedByPerson: true } : { id };
}

/**
 * Each automatic close, set up so it would close `tab` were the person never
 * to have used it, and whether it closes one they did.
 */
const closePaths = [
  {
    closesUsed: false,
    path: "archive",
    run: async (tab: OpenedTab) => {
      await setChatState(chatDir(chatId), { openedTabs: [tab] });
      await closeChatTabs(chatId, { trashed: false }).done;
    },
  },
  {
    closesUsed: true,
    path: "trash",
    run: async (tab: OpenedTab) => {
      await setChatState(chatDir(chatId), { openedTabs: [tab] });
      await closeChatTabs(chatId, { trashed: true }).done;
    },
  },
  {
    closesUsed: false,
    path: "hidden-tab cap",
    run: async (tab: OpenedTab) => {
      lifetimes.set(tab.id, { drawn: false, hiddenForMs: 9e9, unloadsInMs: 0 });
      await setChatState(chatDir(chatId), {
        openedTabs: [
          ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
            openedTab(i),
          ),
          tab,
        ],
      });
      await closeTabsOverCap(chatId);
    },
  },
];

describe.each(closePaths)("the $path", ({ closesUsed, run }) => {
  it("closes a tab the person never used", async () => {
    const tab = openedTab(1);

    await run(tab);

    expect(closes).toContain(tab.id);
  });

  it(`${closesUsed ? "closes" : "keeps"} a tab the person used`, async () => {
    const tab = openedTab(1, true);

    await run(tab);

    expect(closes.includes(tab.id)).toBe(closesUsed);
  });
});

describe("closeChatTabs", () => {
  it("answers how many tabs it closes as the chat is archived", async () => {
    await setChatState(chatDir(chatId), {
      openedTabs: [openedTab(1), openedTab(2), openedTab(3, true)],
    });

    const { closed, done } = closeChatTabs(chatId, { trashed: false });

    expect(await closed).toBe(2);
    await done;
  });
});

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

  it("closes a tab on an HTML file by the tab's id, and keeps word of it under that id", async () => {
    const page = openedTab(500);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      page,
    ];
    const fileTab = StoreId.newTabId();
    listed.ids = tabs.map((tab) => tab.id);
    listed.drawnFor.set(page.id, fileTab);
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([fileTab]);
    expect((await getChatState(chatDir(chatId))).closedTabs).toEqual([
      { id: fileTab, reason: "tabCap", url: "https://example.com/" },
    ]);
  });

  it("closes a tab an agent is working in behind the chat last", async () => {
    const workedIn = openedTab(500);
    const idle = openedTab(400);
    noteBrowserAgentActivity(workedIn.id);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP - 1 }, (_, i) =>
        openedTab(i),
      ),
      workedIn,
      idle,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([idle.id]);
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

  it("closes the tab hidden longest among those the person never used", async () => {
    const used = openedTab(900, true);
    const unused = openedTab(500);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      used,
      unused,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([unused.id]);
  });

  it("keeps the tab an agent just opened when tabs the person used fill the cap", async () => {
    const fresh = openedTab(0);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
        openedTab(i + 1, true),
      ),
      fresh,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
  });

  it("closes none when every hidden tab is one the person used", async () => {
    const tabs = Array.from({ length: CHAT_HIDDEN_TAB_CAP + 3 }, (_, i) =>
      openedTab(i, true),
    );
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
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

describe("closing a chat's tabs", () => {
  it("notes a tab once when two closes race for it", async () => {
    const tab = openedTab(500);
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => openedTab(i)),
      tab,
    ];
    await setChatState(chatDir(chatId), { openedTabs: tabs });

    await Promise.all([closeTabsOverCap(chatId), closeTabsOverCap(chatId)]);

    const { closedTabs } = await getChatState(chatDir(chatId));
    expect(closedTabs.filter((closed) => closed.id === tab.id)).toHaveLength(1);
  });
});

describe("a tab on an HTML file whose page changed", () => {
  // An agent's tab, kept by the id agents name it by, which is the id of the
  // page it opened on; the tab walked to another file and back since, and a
  // new page draws it.
  function walked(minutes: number) {
    const tab = openedTab(minutes);
    const next = browserTargetOf(StoreId.newTabId());
    lifetimes.set(next, lifetimes.get(tab.id)!);
    lifetimes.delete(tab.id);
    listed.drawnFor.set(next, tab.id);
    return { next, tab };
  }

  it("is closed past the cap by the tab's id, by how long its new page was out of sight", async () => {
    const { next, tab } = walked(500);
    const others = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
      openedTab(i),
    );
    listed.ids = [...others.map((each) => each.id), next];
    await setChatState(chatDir(chatId), { openedTabs: [...others, tab] });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([tab.id]);
    expect((await getChatState(chatDir(chatId))).closedTabs).toEqual([
      { id: tab.id, reason: "tabCap", url: "https://example.com/" },
    ]);
  });

  it("is kept while it shows a file no page draws", async () => {
    const tab = openedTab(500);
    lifetimes.delete(tab.id);
    const others = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
      openedTab(i + 1000),
    );
    listed.ids = others.map((each) => each.id);
    listed.pageless = [tab.id];
    await setChatState(chatDir(chatId), { openedTabs: [...others, tab] });

    await closeTabsOverCap(chatId);

    expect(closes).not.toContain(tab.id);
    expect(
      (await getChatState(chatDir(chatId))).openedTabs.map((each) => each.id),
    ).toContain(tab.id);
  });

  it.each([
    { onScreen: false, trashed: false, closed: true },
    { onScreen: true, trashed: false, closed: false },
    { onScreen: true, trashed: true, closed: true },
  ])(
    "is closed as the chat is archived or trashed by its new page being on screen or not: %o",
    async ({ closed, onScreen, trashed }) => {
      const { next, tab } = walked(5);
      lifetimes.set(next, {
        drawn: onScreen,
        hiddenForMs: onScreen ? null : 5 * 60_000,
        unloadsInMs: null,
      });
      listed.ids = [next];
      await setChatState(chatDir(chatId), { openedTabs: [tab] });

      await closeChatTabs(chatId, { trashed }).done;

      expect(closes).toEqual(closed ? [tab.id] : []);
    },
  );

  it("is left open as the chat is archived while it is on screen showing a file no page draws", async () => {
    const tab = openedTab(5);
    lifetimes.delete(tab.id);
    listed.ids = [];
    listed.pageless = [tab.id];
    listed.up.add(tab.id);
    await setChatState(chatDir(chatId), { openedTabs: [tab] });

    await closeChatTabs(chatId, { trashed: false }).done;

    expect(closes).toEqual([]);
  });
});

describe("a chat state an earlier build wrote", () => {
  it("names a tab on an HTML file by its page's id, which reads as the tab and is written as the tab's id", async () => {
    const page = openedTab(5);
    const fileTab = StoreId.newTabId();
    const oldest = openedTab(500);
    const others = Array.from({ length: CHAT_HIDDEN_TAB_CAP - 1 }, (_, i) =>
      openedTab(i),
    );
    listed.ids = [...others, page, oldest].map((each) => each.id);
    listed.drawnFor.set(page.id, fileTab);
    await setChatState(chatDir(chatId), {
      openedTabs: [...others, page, oldest],
    });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([oldest.id]);
    const ids = (await getChatState(chatDir(chatId))).openedTabs.map(
      (each) => each.id,
    );
    expect(ids).toContain(fileTab);
    expect(ids).not.toContain(page.id);
  });
});

describe("an agent's tab the person moved to a tab group of their own", () => {
  function moved() {
    const tab = openedTab(500);
    listed.ids = [];
    listed.elsewhere = [tab.id];
    return tab;
  }

  it("is forgotten by the cap, which closes nothing for it", async () => {
    const tab = moved();
    const others = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
      openedTab(i),
    );
    listed.ids = others.map((each) => each.id);
    await setChatState(chatDir(chatId), { openedTabs: [...others, tab] });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
    expect(
      (await getChatState(chatDir(chatId))).openedTabs.map((each) => each.id),
    ).not.toContain(tab.id);
  });

  it("is left open and forgotten as the chat is archived", async () => {
    const tab = moved();
    await setChatState(chatDir(chatId), { openedTabs: [tab] });

    const { closed, done } = closeChatTabs(chatId, { trashed: false });

    expect(await closed).toBe(0);
    await done;
    expect(closes).toEqual([]);
    expect((await getChatState(chatDir(chatId))).openedTabs).toEqual([]);
  });
});
