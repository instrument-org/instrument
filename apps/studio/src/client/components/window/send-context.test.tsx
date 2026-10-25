import { type Draft, draftGroupOf } from "@/shared/drafts";
import {
  CHATS_HREF,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { fileUrlOf } from "@/client/lib/file-url";
import {
  MountedFolder,
  type SessionMessageDataPart,
  ChatIdSchema,
} from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contextReaders, type SendContextWindow } from "./send-context";

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
    dismissed: {},
    drafts: [],
    href: "/browser",
    paneOpenByGroup: {},
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
      windowOf({ windowTabs: tabsOf([SITE], CHAT) }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        isPoppedOut: false,
        isViewOpen: true,
        leftOut: [],
      }),
    ).resolves.toMatchObject({
      page: { selection: "Words on the page" },
      screen: "browser",
      url: "https://example.com/",
    });
  });

  it("names only the chat's tabs while its view is put away and nothing else is up", async () => {
    const { sendContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([SITE], CHAT) }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        isPoppedOut: false,
        isViewOpen: false,
        leftOut: [],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "screen": "conversation",
        "tabs": [
          {
            "at": "https://example.com/",
            "id": "guest",
            "title": "Example",
          },
        ],
      }
    `);
  });

  it("tells a popped-out chat nothing about the chat on screen", async () => {
    const other = ChatIdSchema.parse("2026-10-02-other");
    const { sendContext } = contextReaders(
      windowOf({
        paneOpenByGroup: { [CHAT]: true },
        windowTabs: tabsOf([SITE], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: other,
        isPoppedOut: true,
        isViewOpen: false,
        leftOut: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("tells a chat in the tab's place nothing about what else is in view", async () => {
    const site: WindowTab = { ...SITE, group: "site:1", id: "site" };
    const { sendContext } = contextReaders(
      windowOf({
        paneOpenByGroup: { "site:1": true },
        windowTabs: tabsOf([site], "site:1"),
      }),
    );
    const send = (isPoppedOut: boolean) =>
      sendContext({
        chatId: CHAT,
        isPoppedOut,
        isViewOpen: false,
        leftOut: [],
      });
    await expect(send(false)).resolves.toBeUndefined();
    await expect(send(true)).resolves.toMatchObject({ screen: "browser" });
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
        isPoppedOut: false,
        isViewOpen: true,
        leftOut: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("sends the page's words with the tabs the conversation can name", async () => {
    const chat: WindowTab = {
      group: CHAT,
      href: `${CHATS_HREF}/${CHAT}`,
      id: "chat",
      kind: "screen",
    };
    const { sendContext } = contextReaders(
      windowOf({
        screenView: { screen: "browser" },
        windowTabs: tabsOf([SITE, chat], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        isPoppedOut: false,
        isViewOpen: true,
        leftOut: [],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
          "tab": "guest",
          "tabs": [
            {
              "id": "chat",
              "title": "Lisbon",
              "url": "/chats/2026-10-01-lisbon",
            },
          ],
          "title": "Example",
          "url": "https://example.com/",
        },
        "screen": "browser",
        "tabs": [
          {
            "at": "https://example.com/",
            "id": "guest",
            "title": "Example",
          },
          {
            "at": "/chats/2026-10-01-lisbon",
            "id": "chat",
            "title": "Lisbon",
          },
        ],
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
        windowTabs: tabsOf([file], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        isPoppedOut: false,
        isViewOpen: true,
        leftOut: [],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "file": {
          "mount": "/Users/casey/Downloads/receipt.pdf",
          "name": "receipt.pdf",
          "path": "/Users/casey/Downloads/receipt.pdf",
        },
        "screen": "file",
        "tabs": [
          {
            "at": "/Users/casey/Downloads/receipt.pdf",
            "id": "file",
            "title": "receipt.pdf",
          },
        ],
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
        windowTabs: tabsOf([SITE], CHAT),
      }),
    );
    const sent = sendContext({
      chatId: CHAT,
      isPoppedOut: false,
      isViewOpen: true,
      leftOut: [],
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(sent).resolves.toMatchInlineSnapshot(`
      {
        "screen": "browser",
        "tabs": [
          {
            "at": "https://example.com/",
            "id": "guest",
            "title": "Example",
          },
        ],
        "url": "https://example.com/",
      }
    `);
  });

  it("describes a chat's tasks tab as its screen reports it", async () => {
    const tasksTab: WindowTab = {
      group: CHAT,
      href: `/tasks?chat=${CHAT}`,
      id: "tasks",
      kind: "screen",
    };
    const { sendContext } = contextReaders(
      windowOf({
        href: tasksTab.href,
        screenView: {
          screen: "tasks",
          tasks: [
            {
              id: ChatIdSchema.parse("scan"),
              status: "working",
              step: "Reading Downloads",
              title: "Scan the receipts",
            },
          ],
        },
        windowTabs: tabsOf([tasksTab, SITE], CHAT),
      }),
    );
    await expect(
      sendContext({
        chatId: CHAT,
        isPoppedOut: false,
        isViewOpen: true,
        leftOut: [],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "screen": "tasks",
        "tabs": [
          {
            "at": "/tasks?chat=2026-10-01-lisbon",
            "id": "tasks",
            "title": "Tasks",
          },
          {
            "at": "https://example.com/",
            "id": "guest",
            "title": "Example",
          },
        ],
        "tasks": [
          {
            "id": "scan",
            "status": "working",
            "step": "Reading Downloads",
            "title": "Scan the receipts",
          },
        ],
        "url": "/tasks?chat=2026-10-01-lisbon",
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
  const GROUP = draftGroupOf(DRAFT.id);
  /** The band's own face, which is not carried to the chat. */
  const HOME_TAB: WindowTab = {
    group: GROUP,
    href: NEW_TAB_HREF,
    id: "home",
    kind: "screen",
  };

  it("sends nothing for a draft whose window has nothing up", async () => {
    const { draftContext } = contextReaders(windowOf({ drafts: [DRAFT] }));
    await expect(draftContext(DRAFT.id)).resolves.toBeUndefined();
  });

  it("sends the band's page and the draft's tabs as the chat starts", async () => {
    const band: WindowTab = {
      group: GROUP,
      id: "band",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const chat: WindowTab = {
      group: GROUP,
      href: `${CHATS_HREF}/${CHAT}`,
      id: "chat",
      kind: "screen",
    };
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [DRAFT],
        windowTabs: tabsOf([band, chat]),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "attached": [
          {
            "kind": "page",
            "title": "Hotels",
            "url": "https://hotels.example/",
          },
        ],
        "page": {
          "selection": "Words on the page",
          "tab": "band",
          "tabs": [
            {
              "id": "chat",
              "title": "Lisbon",
              "url": "/chats/2026-10-01-lisbon",
            },
          ],
          "title": "Example",
          "url": "https://example.com/",
        },
        "screen": "browser",
        "tabs": [
          {
            "at": "https://hotels.example/",
            "id": "band",
            "title": "Hotels",
          },
          {
            "at": "/chats/2026-10-01-lisbon",
            "id": "chat",
            "title": "Lisbon",
          },
        ],
        "url": "https://hotels.example/",
      }
    `);
  });

  const APP = "/apps/notion";

  it.each<
    [string, Draft["context"], SessionMessageDataPart.ViewContextDataPart]
  >([
    [
      "app",
      [{ kind: "link", url: "instrument://app/notion" }],
      {
        app: {
          name: "Notion",
          site: "https://notion.so",
          slug: "notion",
          standing: "unknown",
        },
        screen: "apps",
        tabs: [],
        url: APP,
      },
    ],
    [
      "page",
      [{ kind: "link", url: "https://example.com/" }],
      {
        page: {
          selection: "Words on the page",
          title: "Example",
          url: "https://example.com/",
        },
        screen: "browser",
        tabs: [],
        url: "https://example.com/",
      },
    ],
  ])(
    "describes the %s the draft names by its address, without an id",
    async (_kind, context, expected) => {
      const { draftContext } = contextReaders(
        windowOf({
          drafts: [{ ...DRAFT, ...(context ? { context } : {}) }],
          windowTabs: tabsOf([HOME_TAB]),
        }),
      );
      await expect(draftContext(DRAFT.id)).resolves.toMatchObject(expected);
    },
  );

  it("reads a page the draft names from the window's own tab at that address", async () => {
    const open: WindowTab = {
      group: "site:1",
      id: "open",
      kind: "page",
      openedAt: 1,
      title: "Example",
      url: "https://example.com/",
    };
    const readPage = vi.fn(() => Promise.resolve(undefined));
    const { draftContext } = contextReaders(
      windowOf({
        browser: { readPage },
        drafts: [
          {
            ...DRAFT,
            context: [{ kind: "link", url: "https://example.com/" }],
          },
        ],
        windowTabs: tabsOf([HOME_TAB, open]),
      }),
    );
    await draftContext(DRAFT.id);
    expect(readPage).toHaveBeenCalledWith("open");
  });

  it("sends nothing for a band that shows only a new tab", async () => {
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [DRAFT],
        windowTabs: tabsOf([HOME_TAB]),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(
      `undefined`,
    );
  });

  it("sends what the draft names by its path, reached through its grant", async () => {
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [
          {
            ...DRAFT,
            context: [
              { kind: "file", path: "/Users/casey/Notes/plan.md" },
              { kind: "folder", path: "/Volumes/Backup" },
            ],
          },
        ],
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "attached": [
          {
            "items": [
              {
                "kind": "file",
                "path": "/Users/casey/Notes/plan.md",
              },
            ],
            "kind": "paths",
          },
          {
            "items": [
              {
                "kind": "folder",
                "path": "/Volumes/Backup",
              },
            ],
            "kind": "paths",
          },
        ],
        "chosen": [
          {
            "kind": "file",
            "mount": "/Users/casey/Notes/plan.md",
            "name": "plan.md",
            "path": "/Users/casey/Notes/plan.md",
          },
          {
            "kind": "folder",
            "name": "Backup",
            "path": "/Volumes/Backup",
          },
        ],
        "screen": "home",
        "tabs": [],
      }
    `);
  });

  it("sends what is in view behind the draft, and nothing it dismissed", async () => {
    const PLACE = "place:files";
    const file: WindowTab = {
      group: PLACE,
      href: "/files?file=%2FUsers%2Fcasey%2FNotes%2Fplan.md&path=&root=~",
      id: "file",
      kind: "screen",
    };
    const behindFile = (dismissed: string[]) =>
      contextReaders(
        windowOf({
          dismissed: { [DRAFT.id]: dismissed },
          drafts: [DRAFT],
          windowTabs: tabsOf([file], PLACE),
        }),
      ).draftContext(DRAFT.id);
    await expect(behindFile([])).resolves.toMatchObject({
      file: { path: "/Users/casey/Notes/plan.md" },
      screen: "file",
    });
    await expect(
      behindFile([`tab:file ${file.href}`]),
    ).resolves.toBeUndefined();
  });

  it("never sends the chat on screen as what was in view", async () => {
    const page: WindowTab = {
      group: CHAT,
      id: "page",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [DRAFT],
        paneOpenByGroup: { [CHAT]: true },
        windowTabs: tabsOf([page], CHAT),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toBeUndefined();
  });

  it("names the chat the draft names, and nothing for one trashed since", async () => {
    const named = contextReaders(
      windowOf({
        drafts: [{ ...DRAFT, context: [{ chat: CHAT, kind: "chat" }] }],
      }),
    );
    await expect(named.draftContext(DRAFT.id)).resolves.toMatchObject({
      chat: { id: CHAT, title: "Lisbon" },
      screen: "chat",
    });

    const gone = ChatIdSchema.parse("2026-10-02-gone");
    const trashed = contextReaders(
      windowOf({
        drafts: [{ ...DRAFT, context: [{ chat: gone, kind: "chat" }] }],
      }),
    );
    await expect(trashed.draftContext(DRAFT.id)).resolves.toBeUndefined();
  });

  it("leaves out the band's page the person took off", async () => {
    const band: WindowTab = {
      group: GROUP,
      id: "band",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const { draftContext } = contextReaders(
      windowOf({
        dismissed: { [DRAFT.id]: ["tab:band"] },
        drafts: [DRAFT],
        windowTabs: tabsOf([band]),
      }),
    );
    const context = await draftContext(DRAFT.id);
    expect(context?.attached).toBeUndefined();
    expect(context?.page).toBeUndefined();
  });
});
