import {
  CHATS_HREF,
  type Draft,
  draftGroupOf,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { fileUrlOf } from "@/client/lib/file-url";
import { fileHref, folderHref } from "@/shared/computer-href";
import { TabIdSchema } from "@/shared/tabs";
import {
  FolderAttachment,
  type SessionMessageDataPart,
  ChatIdSchema,
} from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contextReaders, type SendContextWindow } from "./send-context";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const HOME = FolderAttachment.Schema.parse({
  access: "read-write",
  createdAt: 0,
  id: "home",
  mountName: "Home",
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
    drafts: [],
    finders: {},
    href: "/browser",
    hrefOfAppTab: vi.fn(),
    paneOpenByGroup: {},
    screenView: null,
    state: { folders: { home: HOME } },
    viewsById: {},
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
      sendContext({ chatId: CHAT, isViewOpen: true }),
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
    await expect(sendContext({ chatId: CHAT, isViewOpen: false })).resolves
      .toMatchInlineSnapshot(`
      {
        "screen": "home",
        "tabs": [
          {
            "at": "https://example.com/",
            "id": "guest",
            "title": "Example",
          },
        ],
        "url": "/browser",
      }
    `);
  });

  it("tells a popped-out chat about the page up in the chat on screen", async () => {
    const other = ChatIdSchema.parse("2026-10-02-other");
    const { sendContext } = contextReaders(
      windowOf({
        paneOpenByGroup: { [CHAT]: true },
        windowTabs: tabsOf([SITE], CHAT),
      }),
    );
    await expect(sendContext({ chatId: other, isViewOpen: false })).resolves
      .toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
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
        ],
        "url": "https://example.com/",
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
      sendContext({ chatId: CHAT, isViewOpen: true }),
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
    await expect(sendContext({ chatId: CHAT, isViewOpen: true })).resolves
      .toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
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
    await expect(sendContext({ chatId: CHAT, isViewOpen: true })).resolves
      .toMatchInlineSnapshot(`
      {
        "file": {
          "mount": "/mnt/Home/Downloads/receipt.pdf",
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
    const sent = sendContext({ chatId: CHAT, isViewOpen: true });
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
    await expect(sendContext({ chatId: CHAT, isViewOpen: true })).resolves
      .toMatchInlineSnapshot(`
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
        viewsById: { [GROUP]: { screen: "browser" } },
        windowTabs: tabsOf([band, chat]),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
          "tab": "band",
          "tabs": [
            {
              "id": "other",
              "title": "Other",
              "url": "https://other.example/",
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

  const FOLDER = folderHref("/Users/casey/Documents");
  const FILE = fileHref("/Users/casey/Downloads/receipt.pdf");
  const APP = "/apps/notion";
  /** The band's face as the chat is told it, ahead of the thing included. */
  const NEW_TAB = { at: NEW_TAB_HREF, id: "home", title: "New tab" };

  it.each<[string, WindowTab, SessionMessageDataPart.ViewContextDataPart]>([
    [
      "folder",
      { group: "place:files", href: FOLDER, id: "over", kind: "screen" },
      {
        folder: {
          display: "/Users/casey/Documents",
          mount: "/mnt/Home/Documents",
          selected: [],
        },
        screen: "computer",
        tabs: [NEW_TAB, { at: FOLDER, title: "Documents" }],
        url: FOLDER,
      },
    ],
    [
      "file",
      { group: "place:files", href: FILE, id: "over", kind: "screen" },
      {
        file: {
          mount: "/mnt/Home/Downloads/receipt.pdf",
          name: "receipt.pdf",
          path: "/Users/casey/Downloads/receipt.pdf",
        },
        screen: "file",
        tabs: [NEW_TAB, { at: FILE, title: "receipt.pdf" }],
        url: FILE,
      },
    ],
    [
      "app",
      { group: "place:apps", href: APP, id: "over", kind: "screen" },
      {
        app: {
          name: "Notion",
          site: "https://notion.so",
          slug: "notion",
          standing: "unknown",
        },
        screen: "apps",
        tabs: [NEW_TAB, { at: APP, title: "Notion" }],
        url: APP,
      },
    ],
    [
      "page",
      {
        group: "place:apps",
        id: "over",
        kind: "page",
        openedAt: 1,
        title: "Example",
        url: "https://example.com/",
      },
      {
        page: {
          selection: "Words on the page",
          title: "Example",
          url: "https://example.com/",
        },
        screen: "browser",
        tabs: [NEW_TAB, { at: "https://example.com/", title: "Example" }],
        url: "https://example.com/",
      },
    ],
  ])(
    "describes the %s the draft was opened over, without an id, when the band shows home",
    async (_kind, over, expected) => {
      const draft: Draft = {
        ...DRAFT,
        included: { group: over.group ?? "", tabId: over.id },
      };
      const { draftContext } = contextReaders(
        windowOf({
          drafts: [draft],
          viewsById: { [GROUP]: { screen: "home" } },
          windowTabs: tabsOf([HOME_TAB, over]),
        }),
      );
      await expect(draftContext(DRAFT.id)).resolves.toEqual(expected);
    },
  );

  describe("over the window's own tabs", () => {
    const FILES_TAB = TabIdSchema.parse("files");
    const APPS_TAB = TabIdSchema.parse("apps");
    const NOTES = "/Users/casey/Documents/notes.md";
    const drafted = (draft: Partial<Draft>, over: Partial<SendContextWindow>) =>
      contextReaders(
        windowOf({
          drafts: [{ ...DRAFT, ...draft }],
          hrefOfAppTab: (id) => ({ [APPS_TAB]: APP, [FILES_TAB]: FOLDER })[id],
          viewsById: { [GROUP]: { screen: "home" } },
          windowTabs: tabsOf([HOME_TAB]),
          ...over,
        }),
      ).draftContext(DRAFT.id);

    it("describes the app's front its tab stands on now", async () => {
      await expect(
        drafted(
          { included: { appTabId: APPS_TAB } },
          { appTabId: FILES_TAB, href: FOLDER },
        ),
      ).resolves.toMatchObject({
        app: { name: "Notion", slug: "notion" },
        screen: "apps",
        url: APP,
      });
    });

    it("sends what is selected in the Finder of the tab it was opened over as picked", async () => {
      await expect(
        drafted(
          { included: { appTabId: FILES_TAB } },
          {
            appTabId: FILES_TAB,
            finders: {
              [FILES_TAB]: {
                folder: "/Users/casey/Documents",
                selected: [{ kind: "file", path: NOTES }],
              },
            },
            href: FOLDER,
          },
        ),
      ).resolves.toMatchObject({
        chosen: [
          {
            kind: "file",
            mount: "/mnt/Home/Documents/notes.md",
            name: "notes.md",
            path: NOTES,
          },
        ],
        folder: { display: "/Users/casey/Documents" },
      });
    });

    it("sends the Finder up behind the draft by what is selected in it, in place of its folder", async () => {
      const context = await drafted(
        { included: { appTabId: APPS_TAB } },
        {
          appTabId: FILES_TAB,
          finders: {
            [FILES_TAB]: {
              folder: "/Users/casey/Documents",
              selected: [{ kind: "file", path: NOTES }],
            },
          },
          href: FOLDER,
        },
      );
      expect(context?.chosen).toEqual([
        {
          kind: "file",
          mount: "/mnt/Home/Documents/notes.md",
          name: "notes.md",
          path: NOTES,
        },
      ]);
    });

    it("leaves out the tab the person left out", async () => {
      const context = await drafted(
        { included: { appTabId: APPS_TAB }, leftBehind: [FILES_TAB] },
        { appTabId: FILES_TAB, href: FOLDER },
      );
      expect(context?.chosen).toBeUndefined();
    });
  });

  it("sends the band's own screen when nothing was included", async () => {
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [DRAFT],
        viewsById: { [GROUP]: { screen: "home" } },
        windowTabs: tabsOf([HOME_TAB]),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "screen": "home",
        "tabs": [
          {
            "at": "/new-tab",
            "id": "home",
            "title": "New tab",
          },
        ],
        "url": "/new-tab",
      }
    `);
  });

  it("sends what the draft was opened on by name, reached through its grant", async () => {
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [
          {
            ...DRAFT,
            chosen: [
              { kind: "file", path: "/Users/casey/Notes/plan.md" },
              { kind: "folder", path: "/Volumes/Backup" },
            ],
          },
        ],
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "chosen": [
          {
            "kind": "file",
            "mount": "/mnt/Home/Notes/plan.md",
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

  it("sends what is in view behind the draft, and nothing the person left out", async () => {
    const PLACE = "place:files";
    const file: WindowTab = {
      group: PLACE,
      href: "/files?file=%2FUsers%2Fcasey%2FNotes%2Fplan.md&path=&root=~",
      id: "file",
      kind: "screen",
    };
    const page: WindowTab = {
      group: CHAT,
      id: "page",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const behindFile = contextReaders(
      windowOf({ drafts: [DRAFT], windowTabs: tabsOf([file], PLACE) }),
    );
    await expect(behindFile.draftContext(DRAFT.id)).resolves
      .toMatchInlineSnapshot(`
      {
        "file": {
          "mount": "/mnt/Home/Notes/plan.md",
          "name": "plan.md",
          "path": "/Users/casey/Notes/plan.md",
        },
        "screen": "file",
        "tabs": [
          {
            "at": "/files?file=%2FUsers%2Fcasey%2FNotes%2Fplan.md&path=&root=~",
            "id": "file",
            "title": "plan.md",
          },
        ],
        "url": "/files?file=%2FUsers%2Fcasey%2FNotes%2Fplan.md&path=&root=~",
      }
    `);

    const behindPage = contextReaders(
      windowOf({
        drafts: [DRAFT],
        paneOpenByGroup: { [CHAT]: true },
        windowTabs: tabsOf([page], CHAT),
      }),
    );
    await expect(behindPage.draftContext(DRAFT.id)).resolves
      .toMatchInlineSnapshot(`
      {
        "page": {
          "selection": "Words on the page",
          "title": "Example",
          "url": "https://example.com/",
        },
        "screen": "browser",
        "tabs": [
          {
            "at": "https://hotels.example/",
            "id": "page",
            "title": "Hotels",
          },
        ],
        "url": "https://hotels.example/",
      }
    `);

    const leftOut = contextReaders(
      windowOf({
        drafts: [{ ...DRAFT, leftBehind: ["page"] }],
        paneOpenByGroup: { [CHAT]: true },
        windowTabs: tabsOf([page], CHAT),
      }),
    );
    await expect(leftOut.draftContext(DRAFT.id)).resolves.toBeUndefined();

    const paneShut = contextReaders(
      windowOf({ drafts: [DRAFT], windowTabs: tabsOf([page], CHAT) }),
    );
    await expect(paneShut.draftContext(DRAFT.id)).resolves.toBeUndefined();
  });
});
