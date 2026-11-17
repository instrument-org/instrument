import { type Draft } from "@/shared/drafts";
import { CHATS_HREF, type WindowTab } from "@/client/atoms/window";
import { fileUrlOf } from "@/client/lib/file-url";
import { folderHref } from "@/shared/computer-href";
import { MountedFolder, ChatIdSchema } from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contextReaders, type SendContextWindow } from "./send-context";
import { besideOf } from "./tab-model";
import { newChatHref } from "./window-href";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const HOME = MountedFolder.Schema.parse({
  access: "read-write",
  createdAt: 0,
  id: "home",
  path: "/Users/casey",
  source: "user",
});

/** A guest's read that never comes back: the guest is mid-navigation, parked, or hung. */
const NEVER_ANSWERS = new Promise<undefined>(() => {
  // Never settles.
});

/** A site open in the chat's pane. */
const SITE: WindowTab = {
  group: CHAT,
  id: "guest",
  kind: "page",
  openedAt: 1,
  title: "Example",
  url: "https://example.com/",
};

/** The chat's own tab, on the right side of its group: what the window carries is the tab up across from it. */
const CHAT_TAB: WindowTab = {
  group: CHAT,
  href: `${CHATS_HREF}/${CHAT}`,
  id: "chat",
  kind: "screen",
  side: 1,
};

/** The window's tabs, with the group named on screen and its first tab up. */
function tabsOf(
  allTabs: WindowTab[],
  group?: string,
): SendContextWindow["windowTabs"] {
  const tabs =
    group === undefined ? [] : allTabs.filter((tab) => tab.group === group);
  return {
    active: tabs[0],
    allTabs,
    besideOf: (id) => besideOf({ activeByGroup: {}, tabs: allTabs }, id),
    groupOnScreen: group,
    selectedTabIn: (key) => allTabs.find((tab) => tab.group === key),
  };
}

/** A window with nothing up, for each case to put its own thing on. */
function windowOf(over: Partial<SendContextWindow> = {}): SendContextWindow {
  return {
    appsBySlug: new Map([
      ["notion", { name: "Notion", site: "https://notion.so" }],
    ]),
    appTabId: null,
    browser: {
      readPage: (tabId) =>
        Promise.resolve({
          ...(tabId === undefined ? {} : { tab: tabId }),
          tabs: [
            { id: "other", title: "Other", url: "https://other.example/" },
          ],
          selection: "Words on the page",
          title: "Example",
          url: "https://example.com/",
        }),
    },
    chatTitles: new Map([[CHAT, "Lisbon"]]),
    href: "/browser",
    screenView: null,
    state: { folders: { home: HOME } },
    surfaces: {},
    windowTabs: tabsOf([]),
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sendContext", () => {
  it("describes the chat's page though no screen has said what it shows", async () => {
    const { sendContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([SITE, CHAT_TAB], CHAT) }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        tabId: "chat",
      }),
    ).resolves.toMatchObject({
      page: { selection: "Words on the page" },
      screen: "browser",
      url: "https://example.com/",
    });
  });

  it("says only the conversation when the message names no tab", async () => {
    const { sendContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([SITE], CHAT) }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "screen": "conversation",
      }
    `);
  });

  it("sends nothing before the chat's state is read", async () => {
    const { sendContext } = contextReaders(
      windowOf({
        screenView: { screen: "browser" },
        state: undefined,
        windowTabs: tabsOf([SITE], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        tabId: "chat",
      }),
    ).resolves.toBeUndefined();
  });

  it("sends the page's words with its own tab, which a task may be working in", async () => {
    const other: WindowTab = { ...SITE, id: "other", title: "Other" };
    const { sendContext } = contextReaders(
      windowOf({
        screenView: { screen: "browser" },
        windowTabs: tabsOf([SITE, other, CHAT_TAB], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        tabId: "chat",
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
          "tab": "guest",
          "tabs": [
            {
              "id": "guest",
              "title": "Example",
              "url": "https://example.com/",
            },
          ],
          "title": "Example",
          "url": "https://example.com/",
        },
        "screen": "browser",
        "url": "https://example.com/",
      }
    `);
  });

  it("sends a file shown as a page as the file, reached through its grant", async () => {
    const file: WindowTab = {
      group: CHAT,
      id: "file",
      kind: "page",
      openedAt: 1,
      url: fileUrlOf("/Users/casey/Downloads/receipt.pdf"),
    };
    const readPage = vi.fn();
    const { sendContext } = contextReaders(
      windowOf({
        browser: { readPage },
        screenView: { screen: "browser" },
        windowTabs: tabsOf([file, CHAT_TAB], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        tabId: "chat",
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "file": {
          "mount": "/Users/casey/Downloads/receipt.pdf",
          "name": "receipt.pdf",
          "path": "/Users/casey/Downloads/receipt.pdf",
        },
        "groupFiles": [
          "/Users/casey/Downloads/receipt.pdf",
        ],
        "screen": "file",
        "url": "file:///Users/casey/Downloads/receipt.pdf",
      }
    `);
    expect(readPage).not.toHaveBeenCalled();
  });

  it("goes on without the page when the guest never answers", async () => {
    vi.useFakeTimers();
    const { sendContext } = contextReaders(
      windowOf({
        browser: { readPage: () => NEVER_ANSWERS },
        screenView: { screen: "browser" },
        windowTabs: tabsOf([SITE, CHAT_TAB], CHAT),
      }),
    );
    const sent = sendContext({
      chatId: CHAT,
      tabId: "chat",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(sent).resolves.toMatchInlineSnapshot(`
      {
        "screen": "browser",
        "url": "https://example.com/",
      }
    `);
  });

  it("describes a chat's task tab as its screen reports it", async () => {
    const taskTab: WindowTab = {
      group: CHAT,
      href: `/tasks/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=${CHAT}`,
      id: "task",
      kind: "screen",
    };
    const { sendContext } = contextReaders(
      windowOf({
        href: taskTab.href,
        screenView: {
          screen: "task",
          task: {
            id: ChatIdSchema.parse("scan"),
            status: "working",
            step: "Reading Downloads",
            title: "Scan the receipts",
          },
        },
        windowTabs: tabsOf([taskTab, SITE, CHAT_TAB], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        tabId: "chat",
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "screen": "task",
        "task": {
          "id": "scan",
          "status": "working",
          "step": "Reading Downloads",
          "title": "Scan the receipts",
        },
        "url": "/tasks/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=2026-10-01-lisbon",
      }
    `);
  });
});

describe("draftContext", () => {
  const DRAFT: Draft = {
    createdAt: 0,
    id: "d1",
    updatedAt: 0,
    words: "Plan the trip",
  };
  const GROUP = "group:trip";

  it("shows the tab up as the chat starts, attaching none of the draft's tabs", async () => {
    const band: WindowTab = {
      group: GROUP,
      id: "band",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const maps: WindowTab = { ...band, id: "maps", title: "Maps" };
    const newChat: WindowTab = {
      group: GROUP,
      href: newChatHref(DRAFT.id),
      id: "draft",
      kind: "screen",
      side: 1,
    };
    const { draftContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([band, maps, newChat]) }),
    );
    await expect(draftContext(DRAFT, undefined)).resolves
      .toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
          "tab": "band",
          "tabs": [
            {
              "id": "band",
              "title": "Hotels",
              "url": "https://hotels.example/",
            },
          ],
          "title": "Example",
          "url": "https://example.com/",
        },
        "screen": "browser",
        "url": "https://hotels.example/",
      }
    `);
  });

  // A new chat's draft is made in the press that sends it, before its tab's
  // address names the draft, so the tab is the one the sender names.
  it("attaches nothing beside the tab the draft is sent from, which only shows it", async () => {
    const group = "group:1";
    const band: WindowTab = {
      group,
      id: "band",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const newChat: WindowTab = {
      group,
      href: newChatHref(),
      id: "new",
      kind: "screen",
      side: 1,
    };
    const { draftContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([band, newChat]) }),
    );
    const sent = await draftContext(DRAFT, "new");
    expect(sent?.attached).toBeUndefined();
    expect(sent).toMatchObject({
      screen: "browser",
      url: "https://hotels.example/",
    });
    expect(sent?.tabs).toBeUndefined();
  });

  it.each<[string, WindowTab]>([
    [
      "another chat",
      {
        group: "group:1",
        href: `${CHATS_HREF}/${CHAT}`,
        id: "other",
        kind: "screen",
      },
    ],
    [
      "a folder with a file selected in it",
      {
        group: "group:1",
        href: folderHref("/Users/casey/Trips"),
        id: "other",
        kind: "screen",
      },
    ],
  ])(
    "attaches nothing for %s beside the tab the draft is sent from",
    async (_, beside) => {
      const newChat: WindowTab = {
        group: "group:1",
        href: newChatHref(),
        id: "new",
        kind: "screen",
        side: 1,
      };
      const { draftContext } = contextReaders(
        windowOf({
          surfaces: {
            other: {
              finder: {
                folder: "/Users/casey/Trips",
                selected: [
                  { kind: "file", path: "/Users/casey/Trips/plan.md" },
                ],
              },
            },
          },
          windowTabs: tabsOf([beside, newChat]),
        }),
      );
      const sent = await draftContext(DRAFT, "new");
      expect(sent?.attached).toBeUndefined();
      expect(sent?.chat).toBeUndefined();
      expect(sent?.chosen).toBeUndefined();
    },
  );
});
