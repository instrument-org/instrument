import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { createStore } from "jotai";

import { type Chat } from "./chats";
import {
  copiedTabs,
  groupLists,
  isWorthKeeping,
  listedWith,
  listedWithout,
  pinnedFromStars,
  pinnedWith,
  upkeptList,
} from "./tab-groups";
import {
  groupLayoutOf,
  openInGroup,
  raiseTab,
  restoreGroup,
  selectTab,
  type WindowTabs,
} from "./tab-model";
import { chatHref, newChatHref } from "./window-href";

describe("a draft no chat has started, closed", () => {
  const draft = { createdAt: 0, id: "d", updatedAt: 0, words: "" };

  it.each([
    ["is kept with words", { ...draft, words: "Plan the trip" }, true],
    ["goes with nothing in it", draft, false],
    [
      "goes once its chat started",
      {
        ...draft,
        chatId: ChatIdSchema.parse("2026-10-01-roofer"),
        words: "Hi",
      },
      false,
    ],
  ])("%s", (_label, entry, expected) => {
    expect(isWorthKeeping(entry)).toBe(expected);
  });
});

describe("the tab groups another window has open", () => {
  const LISBON = ChatIdSchema.parse("2026-11-10-lisbon");
  const chat = (id: Chat["id"], title: string): Chat => ({
    archived: false,
    firstAsk: "",
    holds: { apps: [], files: [], sites: [] },
    id,
    lastUserMessageAt: 1,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "idle",
    title,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: false,
  });
  const screen = (group: string, id: string, href: string): WindowTab => ({
    group,
    href,
    id,
    kind: "screen",
  });
  const page = (group: string, id: string, title: string): WindowTab => ({
    group,
    id,
    kind: "page",
    openedAt: 1,
    title,
    url: `https://${id}.test/`,
  });
  // This window has a new chat; the other has a chat, a
  // new chat with words and a page beside it, a group of pages alone, and
  // a new chat with nothing in it yet.
  const lists = groupLists({
    chats: [chat(LISBON, "Trip to Lisbon")],
    drafts: [
      { createdAt: 1, id: "plan", updatedAt: 2, words: "Plan the week" },
    ],
    elsewhere: {
      chats: [LISBON],
      groups: [LISBON, "draft:plan", "group:pages", "draft:empty"],
    },
    listed: ["draft:here"],
    pins: {},
    state: {
      activeByGroup: {},
      tabs: [
        screen("draft:here", "h1", newChatHref("here")),
        screen(LISBON, "l1", chatHref(LISBON)),
        screen("draft:plan", "p1", newChatHref("plan")),
        page("draft:plan", "p2", "Calendar"),
        page("group:pages", "g1", "Docs"),
        screen("draft:empty", "e1", newChatHref("empty")),
      ],
    },
  });

  it("lists each one, a chatless one by what names its row", () => {
    expect(
      lists.elsewhere.map(({ group, kind, title }) => ({
        group,
        kind,
        title,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "group": "draft:plan",
          "kind": "draft",
          "title": "Plan the week",
        },
        {
          "group": "2026-11-10-lisbon",
          "kind": "chat",
          "title": "Trip to Lisbon",
        },
        {
          "group": "group:pages",
          "kind": "tabs",
          "title": "New Tab",
        },
        {
          "group": "draft:empty",
          "kind": "tabs",
          "title": "New Tab",
        },
      ]
    `);
  });

  it("leaves a draft another window is writing out of History", () => {
    expect(lists.history).toEqual([]);
  });
});

describe("a tab group's tabs, copied", () => {
  const TABS: WindowTab[] = [
    {
      favicon: "data:icon",
      future: [{ href: "/files", id: "f", kind: "screen" }],
      group: "chat",
      id: "p1",
      isOpened: true,
      kind: "page",
      openedAt: 1,
      openedUrl: "https://example.com",
      past: [{ href: "/files", id: "f", kind: "screen" }],
      title: "Example",
      url: "https://example.com/later",
    },
    {
      group: "chat",
      id: "p2",
      kind: "page",
      openedAt: 1,
      openedUrl: "https://a.test",
    },
    {
      group: "chat",
      history: { entries: ["/files", "/files?path=/x"], index: 1 },
      href: "/files?path=/x",
      id: "s1",
      kind: "screen",
    },
    { group: "chat", href: "/new-tab", id: "s2", kind: "screen" },
  ];

  it("takes each tab at its address, with no history, in a new group", () => {
    let next = 0;
    expect(
      copiedTabs(TABS, {
        group: "draft:copy",
        newId: () => `n${(next += 1)}`,
        now: 5,
        up: "s1",
      }),
    ).toMatchInlineSnapshot(`
      {
        "beside": undefined,
        "tabs": [
          {
            "favicon": "data:icon",
            "group": "draft:copy",
            "id": "n1",
            "kind": "page",
            "openedAt": 5,
            "openedUrl": "https://example.com/later",
            "title": "Example",
            "url": "https://example.com/later",
          },
          {
            "group": "draft:copy",
            "id": "n2",
            "kind": "page",
            "openedAt": 5,
            "openedUrl": "https://a.test",
            "url": "https://a.test",
          },
          {
            "group": "draft:copy",
            "href": "/files?path=/x",
            "id": "n3",
            "kind": "screen",
          },
          {
            "group": "draft:copy",
            "href": "/new-tab",
            "id": "n4",
            "kind": "screen",
          },
        ],
        "up": "n3",
      }
    `);
  });
});

describe("a two-sided tab group, copied", () => {
  it("comes up on the same tab on each side, the keyboard on the same side", () => {
    const tab = (id: string, side?: 1): WindowTab => ({
      group: "g",
      href: `/files?path=/${id}`,
      id,
      kind: "screen",
      ...(side === undefined ? {} : { side }),
    });
    const state: WindowTabs = {
      activeByGroup: { g: "b" },
      besideByGroup: { g: "y" },
      tabs: [tab("a"), tab("b"), tab("x", 1), tab("y", 1), tab("z", 1)],
    };
    let next = 0;
    const copied = copiedTabs(state.tabs, {
      beside: "y",
      group: "copy",
      newId: () => `n${(next += 1)}`,
      now: 0,
      up: "b",
    });
    expect(copied).toMatchObject({ beside: "n4", up: "n2" });
    const shown = raiseTab(
      selectTab(restoreGroup(state, "copy", copied.tabs), "n2"),
      "n4",
    );
    const ups = (group: string) => {
      const layout = groupLayoutOf(shown, group);
      return {
        focused: layout.focused,
        ups: layout.sides.map((side) => side.up),
      };
    };
    expect(ups("copy")).toEqual({ focused: 0, ups: ["n2", "n4"] });
    expect(ups("g")).toEqual({ focused: 0, ups: ["b", "y"] });
  });
});

describe("a chat's tab group, copied", () => {
  it("starts a new chat in place of a chat's tab and a draft's", () => {
    const chat = ChatIdSchema.parse("2026-11-13-copied");
    const copied = copiedTabs(
      [
        { group: chat, href: chatHref(chat), id: "c", kind: "screen" },
        {
          group: chat,
          href: newChatHref("d1"),
          id: "d",
          kind: "screen",
          side: 1,
        },
      ],
      { group: "group:copy", newId: () => "n", now: 0 },
    );
    expect(
      copied.tabs.map((tab) => (tab.kind === "screen" ? tab.href : tab.url)),
    ).toEqual([newChatHref(), newChatHref()]);
  });
});

describe("a tab group's pin", () => {
  const PINS = { "draft:a": true } as const;

  it.each([
    ["pins a group", {}, "draft:a", true, PINS],
    ["takes a pin off", PINS, "draft:a", false, {}],
    [
      "leaves another group's pin",
      PINS,
      "draft:b",
      true,
      { ...PINS, "draft:b": true },
    ],
  ])("%s", (_, pins, group, pinned, expected) => {
    expect(pinnedWith(pins, group, pinned)).toEqual(expected);
  });

  it("keeps the pins as they were when nothing changes", () => {
    expect(pinnedWith(PINS, "draft:a", true)).toBe(PINS);
    expect(pinnedWith(PINS, "draft:b", false)).toBe(PINS);
  });
});

describe("a window's list of tab groups", () => {
  it.each([
    ["at the top", ["a", "b"], "c", ["c", "a", "b"]],
    ["once", ["a", "b"], "a", ["a", "b"]],
    ["in a window that kept none", null, "a", ["a"]],
  ])("takes a group %s", (_, list, group, expected) => {
    expect(listedWith(list, group)).toEqual(expected);
  });

  it.each([
    ["before a group", { before: "c" }, ["a", "x", "c"]],
    ["after a group", { after: "a" }, ["a", "x", "c"]],
    [
      "after a group when the one before is gone",
      { after: "c", before: "z" },
      ["a", "c", "x"],
    ],
    [
      "at the top when it names no group listed",
      { before: "z" },
      ["x", "a", "c"],
    ],
  ])("places a group %s", (_, place, expected) => {
    expect(listedWith(["a", "c"], "x", place)).toEqual(expected);
  });

  it("moves a listed group to its new place", () => {
    expect(listedWith(["a", "b", "c"], "c", { before: "a" })).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("lets a group go and keeps the rest in order", () => {
    expect(listedWithout(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("the groups an earlier build kept, on this build's first launch", () => {
  const LISBON = ChatIdSchema.parse("2026-11-10-lisbon");
  const BUDGET = ChatIdSchema.parse("2026-11-10-budget");
  const SQUARES = ChatIdSchema.parse("2026-11-10-squares");
  const PARKED = ChatIdSchema.parse("2026-11-10-parked");
  const page = (group: string, id: string, url: string): WindowTab => ({
    group,
    id,
    kind: "page",
    openedAt: 1,
    url,
  });
  // What that build kept: a group's tabs under `window-tabs.v10`, none for a
  // group that was its chat or its new chat alone; which chats' cards were
  // closed; pins by group; and each chat's star, which pinned its
  // group. A chatless group's draft is on disk only once it has words.
  const V10: Record<string, { active?: string; tabs: WindowTab[] }> = {
    [BUDGET]: {
      active: "b1",
      tabs: [page(BUDGET, "b1", "https://sheets.test/")],
    },
    [PARKED]: { tabs: [page(PARKED, "k1", "https://parked.test/")] },
    [SQUARES]: {
      active: "q1",
      tabs: [
        page(SQUARES, "q1", "https://example.com/"),
        { group: SQUARES, href: "/files", id: "q2", kind: "screen" },
      ],
    },
    "draft:research": {
      active: "r1",
      tabs: [page("draft:research", "r1", "https://example.com/")],
    },
  };
  const LISTED = [
    "draft:empty",
    "draft:research",
    LISBON,
    "draft:pinned",
    "draft:words",
    "draft:nothing",
    BUDGET,
    SQUARES,
  ];
  const PINS = {
    "draft:empty": true,
    "draft:pinned": true,
    "draft:research": true,
  } as const;
  const DRAFTS = [
    { createdAt: 1, id: "words", updatedAt: 1, words: "Draft words" },
  ];
  const CHATS = [
    { id: LISBON, starred: true },
    { id: BUDGET, starred: false },
    { id: SQUARES, starred: false },
    { id: PARKED, starred: true },
  ];

  let state: WindowTabs;
  let listed: string[];
  let pins: Record<string, true>;
  beforeAll(async () => {
    vi.resetModules();
    const kept = await import("@/client/lib/kept-state");
    kept.clearKeptState();
    for (const [group, member] of Object.entries(V10)) {
      kept.writeKept("layout", `window-tabs.v10/${group}`, member);
    }
    kept.writeKept("view", "tab-groups-chat-closed.v2", { [BUDGET]: true });
    // Carried as the module loads, ahead of the window's first draw.
    const { windowTabsAtom } = await import("./window-tabs");
    const carried = createStore().get(windowTabsAtom);
    const upkept = upkeptList(LISTED, carried, {
      drafts: DRAFTS,
      pins: PINS,
    });
    state = upkept.opening.reduce(
      (current, { group, href }, index) =>
        openInGroup(
          current,
          { group, href, id: `new-${index}`, kind: "screen" },
          { group, select: true },
        ),
      carried,
    );
    listed = upkept.kept;
    pins = pinnedFromStars(PINS, listed, CHATS);
    vi.resetModules();
  });

  /** A group as its row and its sides show it, each tab by its address, the one up on its side marked. */
  const shown = (group: string) => {
    const layout = groupLayoutOf(state, group);
    return {
      keyboard: layout.focused,
      listed: listed.includes(group),
      pinned: group in pins,
      sides: layout.sides.map((side) =>
        side.tabs.map(
          (tab) =>
            `${tab.kind === "screen" ? tab.href : tab.url}${tab.id === side.up ? " (up)" : ""}`,
        ),
      ),
    };
  };

  it.each([
    [
      "a chatless group pinned, with nothing else, as a new chat",
      "draft:empty",
      {
        keyboard: 0,
        listed: true,
        pinned: true,
        sides: [["/chats?draft=empty (up)"]],
      },
    ],
    [
      "a chatless group pinned alone, as a new chat",
      "draft:pinned",
      {
        keyboard: 0,
        listed: true,
        pinned: true,
        sides: [["/chats?draft=pinned (up)"]],
      },
    ],
    [
      "a chatless group with words alone, as its new chat",
      "draft:words",
      {
        keyboard: 0,
        listed: true,
        pinned: false,
        sides: [["/chats?draft=words (up)"]],
      },
    ],
    [
      "a chatless group with tabs, its new chat beside them with the keyboard",
      "draft:research",
      {
        keyboard: 1,
        listed: true,
        pinned: true,
        sides: [["https://example.com/ (up)"], ["/chats?draft=research (up)"]],
      },
    ],
    [
      "a chat alone, pinned by its star",
      LISBON,
      {
        keyboard: 0,
        listed: true,
        pinned: true,
        sides: [[`/chats/${LISBON} (up)`]],
      },
    ],
    [
      "a chat with its card open, beside its tabs with the keyboard",
      SQUARES,
      {
        keyboard: 1,
        listed: true,
        pinned: false,
        sides: [
          ["https://example.com/ (up)", "/files"],
          [`/chats/${SQUARES} (up)`],
        ],
      },
    ],
    [
      "a chat with its card closed, last on its one side",
      BUDGET,
      {
        keyboard: 0,
        listed: true,
        pinned: false,
        sides: [["https://sheets.test/ (up)", `/chats/${BUDGET}`]],
      },
    ],
    [
      "a starred chat no window lists, in History with its tabs and no pin",
      PARKED,
      {
        keyboard: 1,
        listed: false,
        pinned: false,
        sides: [["https://parked.test/ (up)"], [`/chats/${PARKED} (up)`]],
      },
    ],
    [
      "a chatless group with nothing in it, gone",
      "draft:nothing",
      {
        keyboard: 0,
        listed: false,
        pinned: false,
        sides: [[]],
      },
    ],
  ])("keeps %s", (_case, group, expected) => {
    expect(shown(group)).toEqual(expected);
  });

  it("keeps the list in its order", () => {
    expect(listed).toEqual(LISTED.filter((group) => group !== "draft:nothing"));
  });

  it("leaves the pins as they were when no listed chat is starred", () => {
    expect(pinnedFromStars(PINS, [BUDGET], CHATS)).toBe(PINS);
  });
});

