import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { createStore } from "jotai";

import {
  copiedTabs,
  isWorthKeeping,
  listedWith,
  listedWithout,
  namedWith,
  pinnedFromStars,
  pinnedWith,
  upkeptList,
} from "./tab-groups";
import { groupLayoutOf, openInGroup, type WindowTabs } from "./tab-model";
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

describe("a tab group's name", () => {
  const NAMES = { "draft:a": "Wireframes" };

  it.each([
    ["names a group", {}, "draft:a", "Wireframes", NAMES],
    ["trims the name", {}, "draft:a", "  Wireframes ", NAMES],
    [
      "renames a named group",
      NAMES,
      "draft:a",
      "Keepers",
      { "draft:a": "Keepers" },
    ],
    ["takes the name off with a blank one", NAMES, "draft:a", "  ", {}],
    ["leaves another group's name", NAMES, "draft:b", "", NAMES],
  ])("%s", (_, names, group, name, expected) => {
    expect(namedWith(names, group, name)).toEqual(expected);
  });

  it("keeps the names as they were when nothing changes", () => {
    expect(namedWith(NAMES, "draft:a", "Wireframes")).toBe(NAMES);
    expect(namedWith(NAMES, "draft:b", "")).toBe(NAMES);
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
  // closed; names and pins by group; and each chat's star, which pinned its
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
    "draft:named",
    "draft:pinned",
    "draft:words",
    "draft:nothing",
    BUDGET,
    SQUARES,
  ];
  const NAMES = {
    [LISBON]: "Lisbon named",
    "draft:empty": "Empty pinned",
    "draft:named": "Named only",
  };
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
      names: NAMES,
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
      name: NAMES[group as keyof typeof NAMES],
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
      "a chatless group named and pinned, with nothing else, as a new chat",
      "draft:empty",
      {
        keyboard: 0,
        listed: true,
        name: "Empty pinned",
        pinned: true,
        sides: [["/chats?draft=empty (up)"]],
      },
    ],
    [
      "a chatless group named alone, as a new chat",
      "draft:named",
      {
        keyboard: 0,
        listed: true,
        name: "Named only",
        pinned: false,
        sides: [["/chats?draft=named (up)"]],
      },
    ],
    [
      "a chatless group pinned alone, as a new chat",
      "draft:pinned",
      {
        keyboard: 0,
        listed: true,
        name: undefined,
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
        name: undefined,
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
        name: undefined,
        pinned: true,
        sides: [["https://example.com/ (up)"], ["/chats?draft=research (up)"]],
      },
    ],
    [
      "a chat alone, named and pinned by its star",
      LISBON,
      {
        keyboard: 0,
        listed: true,
        name: "Lisbon named",
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
        name: undefined,
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
        name: undefined,
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
        name: undefined,
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
        name: undefined,
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
