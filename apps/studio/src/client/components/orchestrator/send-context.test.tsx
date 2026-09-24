import {
  type Draft,
  draftGroupOf,
  NEW_TAB_HREF,
  THREADS_HREF,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { fileUrlOf } from "@/client/lib/file-url";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  FolderAttachment,
  type SessionMessageDataPart,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contextReaders, type SendContextWindow } from "./send-context";

const THREAD = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const OTHER_THREAD = StoreId.SessionSchema.parse(
  "ses_01JABBBBBBBBBBBBBBBBBBBBBB",
);
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

/** A site open in the thread's pane. */
const SITE: WindowTab = {
  group: THREAD,
  id: "guest",
  kind: "page",
  openedAt: 1,
  title: "Example",
  url: "https://example.com/",
};

function childOf(
  id: string,
  title: string,
  standing: { kind: "done" | "running"; line: string },
  threadId: StoreId.Session,
): NonNullable<SendContextWindow["children"]>[number] {
  return {
    createdAt: new Date(0),
    dir: `/tasks/${id}`,
    id: TaskIdSchema.parse(id),
    standing,
    threadId,
    title,
    updatedAt: new Date(0),
  };
}

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
    tabs,
    tabUpIn: (key) => allTabs.find((tab) => tab.group === key),
  };
}

/** A window with nothing up, for each case to put its own thing on. */
function windowOf(over: Partial<SendContextWindow> = {}): SendContextWindow {
  return {
    appsBySlug: new Map([
      ["notion", { name: "Notion", site: "https://notion.so" }],
    ]),
    browser: {
      readPage: (tabId) =>
        Promise.resolve({
          ...(tabId === undefined ? {} : { tab: tabId }),
          tabs: [
            { id: "other", title: "Other", url: "https://other.example/" },
          ],
          text: "Words on the page",
          title: "Example",
          url: "https://example.com/",
        }),
    },
    children: undefined,
    drafts: [],
    href: "/orchestrator/browser",
    screenView: null,
    state: { attachedFolders: { home: HOME } },
    tasksFace: undefined,
    threadTitles: new Map([[THREAD, "Lisbon"]]),
    viewsById: {},
    windowTabs: tabsOf([]),
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sendContext", () => {
  it("sends nothing before the screen has said what it shows", async () => {
    const { sendContext } = contextReaders(
      windowOf({ windowTabs: tabsOf([SITE], THREAD) }),
    );
    await expect(sendContext()).resolves.toBeUndefined();
  });

  it("sends nothing before the orchestrator's state is read", async () => {
    const { sendContext } = contextReaders(
      windowOf({
        screenView: { screen: "browser" },
        state: undefined,
        windowTabs: tabsOf([SITE], THREAD),
      }),
    );
    await expect(sendContext()).resolves.toBeUndefined();
  });

  it("sends the page's words with the tabs the conversation can name", async () => {
    const thread: WindowTab = {
      group: THREAD,
      href: `${THREADS_HREF}/${THREAD}`,
      id: "thread",
      kind: "screen",
    };
    const { sendContext } = contextReaders(
      windowOf({
        screenView: { screen: "browser" },
        windowTabs: tabsOf([SITE, thread], THREAD),
      }),
    );
    await expect(sendContext()).resolves.toMatchInlineSnapshot(`
      {
        "page": {
          "tabs": [
            {
              "id": "other",
              "title": "Other",
              "url": "https://other.example/",
            },
          ],
          "text": "Words on the page",
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
            "at": "/orchestrator/threads/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "title": "Lisbon",
          },
        ],
        "url": "/orchestrator/browser",
      }
    `);
  });

  it("sends a file shown as a page as the file, reached through its grant", async () => {
    const file: WindowTab = {
      group: THREAD,
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
        windowTabs: tabsOf([file], THREAD),
      }),
    );
    await expect(sendContext()).resolves.toMatchInlineSnapshot(`
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
            "title": "receipt.pdf",
          },
        ],
        "url": "/orchestrator/browser",
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
        windowTabs: tabsOf([SITE], THREAD),
      }),
    );
    const sent = sendContext();
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
        "url": "/orchestrator/browser",
      }
    `);
  });

  it("describes the face over the tab in place of the screen", async () => {
    const { sendContext } = contextReaders(
      windowOf({
        children: [
          childOf(
            "scan",
            "Scan the receipts",
            { kind: "running", line: "Reading Downloads" },
            THREAD,
          ),
          childOf(
            "book",
            "Book the hotel",
            { kind: "done", line: "Booked" },
            OTHER_THREAD,
          ),
        ],
        screenView: { screen: "browser" },
        tasksFace: { overTab: SITE.id, thread: THREAD },
        windowTabs: tabsOf([SITE], THREAD),
      }),
    );
    await expect(sendContext()).resolves.toMatchInlineSnapshot(`
      {
        "screen": "tasks",
        "tabs": [],
        "tasks": [
          {
            "id": "scan",
            "status": "working",
            "step": "Reading Downloads",
            "title": "Scan the receipts",
          },
        ],
        "url": "/orchestrator/browser",
      }
    `);
  });

  it("describes the one task the face has up", async () => {
    const { sendContext } = contextReaders(
      windowOf({
        children: [
          childOf(
            "scan",
            "Scan the receipts",
            { kind: "done", line: "Read" },
            THREAD,
          ),
        ],
        tasksFace: {
          overTab: SITE.id,
          task: TaskIdSchema.parse("scan"),
          thread: THREAD,
        },
        windowTabs: tabsOf([SITE], THREAD),
      }),
    );
    await expect(sendContext()).resolves.toMatchInlineSnapshot(`
      {
        "screen": "task",
        "tabs": [],
        "task": {
          "id": "scan",
          "status": "done",
          "title": "Scan the receipts",
        },
        "url": "/orchestrator/browser",
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
  /** The band's own face, which is not carried to the thread. */
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

  it("sends the band's page and the draft's tabs as the thread starts", async () => {
    const band: WindowTab = {
      group: GROUP,
      id: "band",
      kind: "page",
      openedAt: 1,
      title: "Hotels",
      url: "https://hotels.example/",
    };
    const thread: WindowTab = {
      group: GROUP,
      href: `${THREADS_HREF}/${THREAD}`,
      id: "thread",
      kind: "screen",
    };
    const { draftContext } = contextReaders(
      windowOf({
        drafts: [DRAFT],
        viewsById: { [GROUP]: { screen: "browser" } },
        windowTabs: tabsOf([band, thread]),
      }),
    );
    await expect(draftContext(DRAFT.id)).resolves.toMatchInlineSnapshot(`
      {
        "page": {
          "tab": "band",
          "tabs": [
            {
              "id": "other",
              "title": "Other",
              "url": "https://other.example/",
            },
          ],
          "text": "Words on the page",
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
            "at": "/orchestrator/threads/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "title": "Lisbon",
          },
        ],
        "url": "https://hotels.example/",
      }
    `);
  });

  const FOLDER = folderHref("/Users/casey/Documents");
  const FILE = fileHref("/Users/casey/Downloads/receipt.pdf");
  const APP = "/orchestrator/apps/notion";
  /** The band's face as the thread is told it, ahead of the thing included. */
  const NEW_TAB = { at: NEW_TAB_HREF, title: "New tab" };

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
          text: "Words on the page",
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
            "at": "/orchestrator/home",
            "title": "New tab",
          },
        ],
        "url": "/orchestrator/home",
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
});
