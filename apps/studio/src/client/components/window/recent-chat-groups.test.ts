import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { chatGroupTabs, recentChatsToOpen } from "./recent-chat-groups";
import { chatHref } from "./window-href";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const CHAT = ChatIdSchema.parse("2026-11-20-roof");

const chat = (
  name: string,
  daysAgo: number,
  more: Partial<Chat> = {},
): Chat => ({
  archived: false,
  firstAsk: "",
  holds: { apps: [], files: [], sites: [] },
  id: ChatIdSchema.parse(`2026-11-20-${name}`),
  lastUserMessageAt: NOW - daysAgo * DAY,
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "idle",
  title: name,
  titleByApp: true,
  unread: false,
  unreadByUser: false,
  working: false,
  ...more,
});

describe("the recent chats that open", () => {
  const opened = (chats: Chat[], skip: Chat[] = []) =>
    recentChatsToOpen(chats, {
      now: NOW,
      projects: [{ id: "travel" }, { id: "old", retired: true }],
      skip: new Set(skip.map((each) => each.id)),
    }).map(
      ({ chat: id, project }) =>
        `${id.slice(11)}${project ? ` in ${project}` : ""}`,
    );

  it("are the newest five at the root and three in a project", () => {
    const root = [6, 1, 2, 3, 4, 5].map((day) =>
      chat(`r${day.toString()}`, day),
    );
    const filed = [1, 2, 3, 4].map((day) =>
      chat(`p${day.toString()}`, day + 0.5, { project: "travel" }),
    );
    expect(opened([...root, ...filed])).toEqual([
      "r1",
      "p1 in travel",
      "r2",
      "p2 in travel",
      "r3",
      "p3 in travel",
      "r4",
      "r5",
    ]);
  });

  it("leave out old and archived ones, and put a retired project's at the root", () => {
    expect(
      opened([
        chat("old", 7.1),
        chat("away", 1, { archived: true }),
        chat("retired", 1, { project: "old" }),
      ]),
    ).toEqual(["retired"]);
  });

  it("count one already open among the few, without opening it again", () => {
    const chats = [1, 2, 3, 4, 5, 6].map((day) =>
      chat(`r${day.toString()}`, day),
    );
    expect(opened(chats, chats.slice(0, 1))).toEqual(["r2", "r3", "r4", "r5"]);
  });
});

describe("a chat's group as it opens", () => {
  const EARLIER = {
    active: "b",
    tabs: [
      { group: CHAT, href: "/browser", id: "a", kind: "screen" },
      {
        group: CHAT,
        id: "b",
        kind: "page",
        openedAt: 1,
        past: [{ id: "x", kind: "screen", href: "/files" }],
        title: "Docs",
        url: "https://example.com/",
      },
      { group: CHAT, href: "/files?root=%2Fwork", id: "c", kind: "screen" },
      { group: CHAT, href: "/new-tab", id: "d", kind: "screen" },
    ],
  };
  const tabsOf = (earlier: unknown, isSideOpen = true) => {
    let next = 0;
    return chatGroupTabs(CHAT, {
      earlier,
      group: "group:a",
      isSideOpen,
      newId: () => `n${(next++).toString()}`,
      now: 9,
    });
  };

  it("has what was beside the chat on the right, the same tab up", () => {
    const { beside, tabs } = tabsOf(EARLIER);
    expect(tabs[0]).toMatchObject({ href: chatHref(CHAT), kind: "screen" });
    expect(tabs.slice(1)).toMatchInlineSnapshot(`
      [
        {
          "group": "group:a",
          "id": "n2",
          "kind": "page",
          "openedAt": 9,
          "openedUrl": "https://example.com/",
          "side": 1,
          "title": "Docs",
          "url": "https://example.com/",
        },
        {
          "group": "group:a",
          "href": "/files?root=%2Fwork",
          "id": "n3",
          "kind": "screen",
          "side": 1,
        },
      ]
    `);
    expect(tabs[beside ?? -1]).toMatchObject({ title: "Docs" });
  });

  it.each([
    ["nothing was kept", undefined, true],
    ["what was kept is another shape", { tabs: "no" }, true],
    ["the side was hidden", EARLIER, false],
    ["nothing was up in it", { ...EARLIER, active: undefined }, true],
    [
      "only a new tab was up in it",
      { active: "d", tabs: EARLIER.tabs.slice(3) },
      true,
    ],
  ])("is the chat alone where %s", (_case, earlier, isSideOpen) => {
    const { beside, tabs } = tabsOf(earlier, isSideOpen);
    expect([beside, tabs.length]).toEqual([undefined, 1]);
  });
});
