import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import {
  asksElsewhereThan,
  asksForDraft,
  copiedTabs,
  chatsWithNoTab,
  emptyNewChatUp,
  glintsForNew,
  groupLists,
  groupsInProject,
  isWorthKeeping,
  listedWith,
  listedWithout,
  upkeptList,
} from "./tab-groups";
import {
  groupLayoutOf,
  raiseTab,
  restoreGroup,
  selectTab,
  type WindowTabs,
} from "./tab-model";
import { chatHref, groupHref, newChatHref } from "./window-href";

describe("asksForDraft", () => {
  it.each([
    ["a new tab", newChatHref(), false],
    ["a tab group", groupHref("group:a"), false],
    ["a draft by its id", newChatHref("d"), true],
  ])("%s waits on the drafts: %s", (_case, href, waits) => {
    expect(asksForDraft(href)).toBe(waits);
  });
});

// A tab already showing what an address asks for walks only to a part the
// address names: a bare address leaves it where the person left it.
describe("asksElsewhereThan", () => {
  it.each([
    [
      "another part of Settings",
      "/settings/providers",
      "/settings/general",
      true,
    ],
    [
      "Settings with no part named",
      "/settings",
      "/settings/permissions",
      false,
    ],
    ["the part it is at", "/settings/general", "/settings/general", false],
    ["the debug landing page", "/debug", "/debug/billing", false],
  ])("%s: %s from %s walks: %s", (_case, asked, shown, walks) => {
    expect(asksElsewhereThan(asked, shown)).toBe(walks);
  });
});

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
  const PARIS = ChatIdSchema.parse("2026-11-10-paris");
  // This window has a new chat and Lisbon; the other has Lisbon again, a
  // new chat with words and a page beside it, a group of pages alone, and
  // a new chat with nothing in it yet. Paris has no tab anywhere.
  const lists = groupLists({
    chats: [chat(LISBON, "Trip to Lisbon"), chat(PARIS, "Trip to Paris")],
    drafts: [
      { createdAt: 1, id: "plan", updatedAt: 2, words: "Plan the week" },
    ],
    elsewhere: ["group:lisbon", "group:plan", "group:pages", "group:empty"],
    listed: ["group:here", "group:mine"],
    state: {
      activeByGroup: {},
      tabs: [
        screen("group:here", "h1", newChatHref("here")),
        screen("group:mine", "m1", chatHref(LISBON)),
        screen("group:lisbon", "l1", chatHref(LISBON)),
        screen("group:plan", "p1", newChatHref("plan")),
        page("group:plan", "p2", "Calendar"),
        page("group:pages", "g1", "Docs"),
        screen("group:empty", "e1", newChatHref("empty")),
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
          "group": "group:lisbon",
          "kind": "chat",
          "title": "Trip to Lisbon",
        },
        {
          "group": "group:plan",
          "kind": "draft",
          "title": "Plan the week",
        },
        {
          "group": "group:pages",
          "kind": "tabs",
          "title": "New Tab",
        },
        {
          "group": "group:empty",
          "kind": "tabs",
          "title": "New Tab",
        },
      ]
    `);
  });

  it("shows a chat open in two groups in both", () => {
    expect(
      [...lists.open, ...lists.elsewhere].flatMap((entry) =>
        entry.kind === "chat" ? [entry.group] : [],
      ),
    ).toEqual(["group:mine", "group:lisbon"]);
  });

  it("finds the chats with no tab in this window", () => {
    expect(
      chatsWithNoTab(
        [chat(LISBON, "Trip to Lisbon"), chat(PARIS, "Trip to Paris")],
        {
          activeByGroup: {},
          tabs: [screen("group:mine", "m1", chatHref(LISBON))],
        },
      ).map((each) => each.id),
    ).toEqual([PARIS]);
  });
});

describe("the groups of a project", () => {
  const LISBON = ChatIdSchema.parse("2026-11-10-lisbon");
  const PARIS = ChatIdSchema.parse("2026-11-10-paris");
  const chat = (id: Chat["id"], project?: string): Chat => ({
    archived: false,
    firstAsk: "",
    holds: { apps: [], files: [], sites: [] },
    id,
    lastUserMessageAt: 1,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "idle",
    title: id,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: false,
    ...(project === undefined ? {} : { project }),
  });
  const tab = (group: string, id: string, href: string): WindowTab => ({
    group,
    href,
    id,
    kind: "screen",
  });
  const { open } = groupLists({
    chats: [chat(PARIS, "travel"), chat(LISBON)],
    drafts: [],
    elsewhere: [],
    listed: ["made", "filed", "root", "mixed", "gone", "old"],
    state: {
      activeByGroup: {},
      groups: {
        gone: { project: "deleted" },
        made: { project: "travel" },
        old: { project: "retired" },
      },
      tabs: [
        tab("made", "t1", "/files"),
        tab("filed", "t2", chatHref(PARIS)),
        tab("root", "t3", newChatHref()),
        tab("mixed", "t4", chatHref(LISBON)),
        tab("mixed", "t5", chatHref(PARIS)),
        tab("gone", "t6", newChatHref()),
        tab("old", "t7", newChatHref()),
      ],
    },
  });
  const project = (id: string, retired?: true) => ({
    created: new Date(0),
    id,
    name: id,
    ...(retired ? { retired } : {}),
  });
  const projects = [project("travel"), project("retired", true)];

  it.each([
    ["travel", ["made"]],
    ["retired", ["old"]],
    [undefined, ["filed", "root", "mixed", "gone", "old"]],
  ])("%s lists its own", (id, groups) => {
    expect(
      groupsInProject(open, id, projects).map((entry) => entry.group),
    ).toEqual(groups);
  });
});

describe("the empty new chat a new tab or New glints over", () => {
  const tab = (id: string, href: string): WindowTab => ({
    group: "g",
    href,
    id,
    kind: "screen",
  });
  const state: WindowTabs = {
    activeByGroup: {},
    tabs: [
      tab("blank", newChatHref()),
      tab("draft", newChatHref("d1")),
      tab("files", "/files"),
    ],
  };

  it.each([
    ["an empty new chat", "blank", "blank"],
    ["a new chat writing a draft", "draft", undefined],
    ["another screen", "files", undefined],
  ])("is the tab up when it is %s", (_case, up, expected) => {
    expect(emptyNewChatUp(selectTab(state, up), "g")?.id).toBe(expected);
  });

  it("is none with no group up", () => {
    expect(emptyNewChatUp(state, undefined)).toBeUndefined();
  });
});

describe("whether New glints the composer it brings up", () => {
  const none: ReadonlyMap<string, number> = new Map();
  it.each([
    ["over no empty new chat", undefined, undefined, none, true, false],
    ["over an empty new chat", "a", undefined, none, true, true],
    [
      "a second after the last New",
      "a",
      { at: 0, made: "a" },
      none,
      true,
      true,
    ],
    ["on a held key's repeat", "a", { at: 960, made: "b" }, none, true, false],
    [
      "over the tab New just made",
      "a",
      { at: 500, made: "a" },
      none,
      true,
      false,
    ],
    [
      "over a tab still glinting",
      "a",
      { at: 500, made: undefined },
      new Map([["a", 1]]),
      true,
      false,
    ],
    [
      "again over a tab still glinting, opening none",
      "a",
      { at: 500, made: undefined },
      new Map([["a", 1]]),
      false,
      true,
    ],
  ])("%s", (_case, over, last, glinting, opensTab, expected) => {
    expect(glintsForNew(over, { glinting, last, now: 1000, opensTab })).toBe(
      expected,
    );
  });
});

describe("a tab group's tabs, copied", () => {
  const TABS: WindowTab[] = [
    {
      favicon: "data:icon",
      future: [{ href: "/files", id: "f", kind: "screen" }],
      group: "chat",
      id: "p1",
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
  it("copies a chat's tab as the chat, and a new chat as a new one", () => {
    const chat = ChatIdSchema.parse("2026-11-13-copied");
    const copied = copiedTabs(
      [
        { group: "g", href: chatHref(chat), id: "c", kind: "screen" },
        {
          group: "g",
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
    ).toEqual([chatHref(chat), newChatHref()]);
  });
});

describe("a window's list as upkeep keeps it", () => {
  it("gives a pinned group with no tabs a new tab and lets an unpinned one go", () => {
    const state: WindowTabs = {
      activeByGroup: {},
      groups: { pinned: { pinned: true } },
      tabs: [{ group: "full", href: "/files", id: "f", kind: "screen" }],
    };
    expect(upkeptList(["full", "pinned", "empty"], state)).toEqual({
      kept: ["full", "pinned"],
      opening: [{ group: "pinned", href: "/chats" }],
    });
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
