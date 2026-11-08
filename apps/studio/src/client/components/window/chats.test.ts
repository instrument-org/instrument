import { type ChatId, ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  activityLabel,
  byActivity,
  byLastUserMessage,
  byNewestChat,
  type ChatFilters,
  chatTabMark,
  dayHeading,
  draftTitle,
  type Filterable,
  hasWords,
  inPlace,
  inProject,
  matchesFilters,
  NO_FILTERS,
  outsideFilters,
  type RailChatMark,
  railMarkOf,
  projectSearch,
  strongestMark,
  wordRanges,
} from "./chats";
import { chatHref } from "./window-href";

function chat({
  holds,
  ...overrides
}: Partial<Omit<Filterable, "holds">> & {
  holds?: Partial<Filterable["holds"]>;
} = {}): Filterable {
  return {
    archived: false,
    holds: { apps: [], files: [], sites: [], ...holds },
    firstAsk: "",
    starred: false,
    status: "idle",
    title: "",
    unread: false,
    ...overrides,
  };
}

/** A chat with every kind of words a row shows, for the search to find. */
function wordyChat(): Filterable {
  return chat({
    holds: {
      apps: ["gmail"],
      files: ["/Users/sam/chat/out/Protein-Report.md"],
      sites: ["amazon.com"],
    },
    latest: { text: "Ready to drink, chocolate first." },
    firstAsk: "Find the best RTD protein drink",
    title: "Best priced protein drink",
    project: "shopping",
  });
}

const PROJECT_NAMES = new Map([["shopping", "Shopping"]]);

describe("outsideFilters", () => {
  const chats = [
    wordyChat(),
    chat({ archived: true, title: "Protein powder returns" }),
    chat({ title: "Protein bars", project: "house" }),
    chat({ title: "Roof repair" }),
  ];

  it("finds the chats the words turn up on that the place and the project keep out", () => {
    // The inbox hides the archived one; a project hides the one filed elsewhere.
    expect(
      outsideFilters(
        chats,
        { ...NO_FILTERS, search: "protein" },
        PROJECT_NAMES,
      ).map((each) => each.title),
    ).toEqual(["Protein powder returns"]);
    expect(
      outsideFilters(
        chats,
        { ...NO_FILTERS, search: "protein", projects: ["shopping"] },
        PROJECT_NAMES,
      ).map((each) => each.title),
    ).toEqual(["Protein powder returns", "Protein bars"]);
  });

  it("finds nothing when nothing is searched for, whatever the filters hide", () => {
    expect(
      outsideFilters(chats, { ...NO_FILTERS, projects: ["house"] }),
    ).toEqual([]);
  });
});

describe("matchesFilters", () => {
  it("narrows nothing with nothing set", () => {
    expect(matchesFilters(chat(), NO_FILTERS)).toBe(true);
  });

  it.each<[string, Partial<ChatFilters>, Filterable, Filterable]>([
    [
      "replies not yet seen",
      { tags: ["unread"] },
      chat({ unread: true }),
      chat({ archived: true, unread: true }),
    ],
    [
      "been put away",
      { place: "archived" },
      chat({ archived: true }),
      chat({ unread: true }),
    ],
    [
      "a star",
      { tags: ["starred"] },
      chat({ starred: true }),
      chat({ archived: true, starred: true }),
    ],
    [
      "a project",
      { projects: ["house"] },
      chat({ project: "house" }),
      chat({ project: "money" }),
    ],
    [
      "an app",
      { apps: ["gmail"] },
      chat({ holds: { apps: ["gmail"] } }),
      chat({ holds: { apps: ["github"] } }),
    ],
    [
      "the words",
      { search: "protein" },
      chat({ title: "Best priced protein drink" }),
      chat({ title: "MLS standings" }),
    ],
  ])("keeps what has %s and drops the rest", (_, group, kept, dropped) => {
    const filters = { ...NO_FILTERS, ...group };
    expect(matchesFilters(kept, filters)).toBe(true);
    expect(matchesFilters(dropped, filters)).toBe(false);
  });

  it("holds no chat in the drafts, since a draft is not a chat yet", () => {
    const filters: ChatFilters = { ...NO_FILTERS, place: "drafts" };
    expect(matchesFilters(chat(), filters)).toBe(false);
    expect(matchesFilters(chat({ unread: true }), filters)).toBe(false);
    expect(matchesFilters(wordyChat(), filters, PROJECT_NAMES)).toBe(false);
  });

  it("keeps every chat not put away in the inbox, whatever it holds", () => {
    const filters: ChatFilters = { ...NO_FILTERS, place: undefined };
    expect(matchesFilters(chat(), filters)).toBe(true);
    expect(matchesFilters(chat({ unread: true }), filters)).toBe(true);
    expect(matchesFilters(chat({ status: "waiting" }), filters)).toBe(true);
    expect(matchesFilters(chat({ archived: true }), filters)).toBe(false);
  });

  it.each<[string, ChatFilters, Filterable]>([
    ["Unread", { ...NO_FILTERS, tags: ["unread"] }, chat({ unread: true })],
    [
      "an app",
      { ...NO_FILTERS, apps: ["gmail"] },
      chat({ holds: { apps: ["gmail"] } }),
    ],
    [
      "the words",
      { ...NO_FILTERS, search: "protein" },
      chat({ title: "Protein drink" }),
    ],
  ])("leaves a chat put away out of %s", (_, filters, kept) => {
    expect(matchesFilters(kept, filters)).toBe(true);
    expect(matchesFilters({ ...kept, archived: true }, filters)).toBe(false);
  });

  it("keeps a chat put away in a project it is filed under, as a label does", () => {
    const filters: ChatFilters = { ...NO_FILTERS, projects: ["house"] };
    expect(
      matchesFilters(chat({ archived: true, project: "house" }), filters),
    ).toBe(true);
    expect(
      matchesFilters(chat({ archived: true, project: "garden" }), filters),
    ).toBe(false);
  });

  it.each([
    ["the title", "priced"],
    ["the ask", "rtd"],
    ["the latest line", "chocolate"],
    ["a project's name", "shopping"],
    ["a file's name", "protein-report"],
    ["a site", "amazon"],
    ["an app", "gmail"],
  ])("finds a word in %s, whatever its case", (_, search) => {
    const filters = { ...NO_FILTERS, search: search.toUpperCase() };
    expect(matchesFilters(wordyChat(), filters, PROJECT_NAMES)).toBe(true);
    expect(matchesFilters(chat(), filters, PROJECT_NAMES)).toBe(false);
  });

  it("wants every word searched for, wherever each turns up", () => {
    expect(
      matchesFilters(
        wordyChat(),
        { ...NO_FILTERS, search: "  chocolate  amazon " },
        PROJECT_NAMES,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        wordyChat(),
        { ...NO_FILTERS, search: "chocolate costco" },
        PROJECT_NAMES,
      ),
    ).toBe(false);
    expect(
      matchesFilters(chat(), { ...NO_FILTERS, search: "   " }, PROJECT_NAMES),
    ).toBe(true);
  });

  it("reads a pill only by a name it was given", () => {
    const filters = { ...NO_FILTERS, search: "shopping" };
    expect(matchesFilters(wordyChat(), filters)).toBe(false);
    expect(matchesFilters(wordyChat(), filters, PROJECT_NAMES)).toBe(true);
  });

  it("reads any row's words the same way, for the rows that are not chats", () => {
    expect(hasWords("PROTEIN drink", ["Best priced protein", "drink"])).toBe(
      true,
    );
    expect(hasWords("protein costco", ["Best priced protein drink"])).toBe(
      false,
    );
    expect(hasWords("  ", [])).toBe(true);
  });

  it("wants any of a group's choices and all of the groups", () => {
    const filters = {
      ...NO_FILTERS,
      apps: ["gmail"],
      projects: ["house", "errands"],
    };
    expect(
      matchesFilters(
        chat({ holds: { apps: ["gmail"] }, project: "errands" }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        chat({ holds: { apps: ["gmail"] }, project: "money" }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchesFilters(chat({ holds: { apps: [] }, project: "house" }), filters),
    ).toBe(false);
  });

  it("narrows a mark by the search too", () => {
    const filters: ChatFilters = {
      ...NO_FILTERS,
      search: "protein",
      tags: ["starred"],
    };
    expect(
      matchesFilters(chat({ starred: true, title: "Protein drink" }), filters),
    ).toBe(true);
    expect(
      matchesFilters(chat({ starred: true, title: "MLS standings" }), filters),
    ).toBe(false);
    expect(matchesFilters(chat({ title: "Protein drink" }), filters)).toBe(
      false,
    );
  });
});

describe("the marks the search narrows by", () => {
  it("narrows the place the column stands in, so a starred chat put away is only in Archived", () => {
    const starred = chat({ archived: true, starred: true });
    expect(matchesFilters(starred, { ...NO_FILTERS, tags: ["starred"] })).toBe(
      false,
    );
    expect(
      matchesFilters(starred, {
        ...NO_FILTERS,
        place: "archived",
        tags: ["starred"],
      }),
    ).toBe(true);
  });

  it("wants every mark that is on", () => {
    const filters: ChatFilters = { ...NO_FILTERS, tags: ["starred", "unread"] };
    expect(matchesFilters(chat({ starred: true, unread: true }), filters)).toBe(
      true,
    );
    expect(matchesFilters(chat({ starred: true }), filters)).toBe(false);
  });

  it("narrows a project too", () => {
    const filters: ChatFilters = {
      ...NO_FILTERS,
      projects: ["house"],
      tags: ["unread"],
    };
    expect(
      matchesFilters(chat({ project: "house", unread: true }), filters),
    ).toBe(true);
    expect(matchesFilters(chat({ project: "house" }), filters)).toBe(false);
  });
});

describe("moving the column", () => {
  const searched = {
    ...NO_FILTERS,
    search: "fence",
    tags: ["starred" as const],
  };

  it("leaves a project or an app for a place, keeping the search and its marks", () => {
    expect(
      inPlace(
        { ...searched, apps: ["gmail"], projects: ["house"] },
        "archived",
      ),
    ).toEqual({ ...searched, place: "archived" });
    expect(inPlace({ ...searched, place: "archived" }, undefined)).toEqual(
      searched,
    );
  });

  it("drops the marks in Drafts, since a draft carries neither", () => {
    expect(inPlace(searched, "drafts")).toEqual({
      ...searched,
      place: "drafts",
      tags: [],
    });
  });

  it("steps into a project from any place, and back out of the one it stands in", () => {
    expect(inProject({ ...searched, place: "archived" }, "house")).toEqual({
      ...searched,
      projects: ["house"],
    });
    expect(inProject({ ...searched, projects: ["house"] }, "house")).toEqual(
      searched,
    );
  });
});

describe("the projects' order", () => {
  it("puts the project with the newest chat first, and one with none by when it was made", () => {
    const projects = [
      { created: new Date(2026, 0, 1), id: "old" },
      { created: new Date(2026, 5, 1), id: "fresh" },
      { created: new Date(2026, 1, 1), id: "busy" },
      { created: new Date(2026, 2, 1), id: "quiet" },
    ];
    const chats = [
      { lastUserMessageAt: 50, project: "old" },
      { lastUserMessageAt: 90, project: "busy" },
      { lastUserMessageAt: 10, project: "busy" },
    ];
    expect(byNewestChat(projects, chats).map((project) => project.id)).toEqual([
      "busy",
      "old",
      "fresh",
      "quiet",
    ]);
  });
});

describe("day headings", () => {
  const now = new Date(2026, 10, 7, 15);
  it.each<[string, Date]>([
    ["Today", new Date(2026, 10, 7, 1)],
    ["Yesterday", new Date(2026, 10, 6, 23)],
    ["Tuesday", new Date(2026, 10, 3, 9)],
    ["October 30", new Date(2026, 9, 30, 9)],
    ["December 30, 2025", new Date(2025, 11, 30, 9)],
  ])("says %s", (heading, date) => {
    expect(dayHeading(date, now)).toBe(heading);
  });
});

describe("activity order", () => {
  it("puts the item something last happened in at the top", () => {
    const chats = [
      { id: "b", updatedAt: new Date(2026, 8, 15, 8).getTime() },
      { id: "d", updatedAt: new Date(2026, 8, 16, 11).getTime() },
      { id: "a", updatedAt: new Date(2026, 8, 14, 8).getTime() },
      { id: "c", updatedAt: new Date(2026, 8, 16, 9).getTime() },
    ];
    expect(byActivity(chats).map((row) => row.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("leaves the list it was given as it was", () => {
    const chats = [
      { id: "a", updatedAt: 1 },
      { id: "b", updatedAt: 2 },
    ];
    const sorted = byActivity(chats);
    expect(sorted).not.toBe(chats);
    expect(chats.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("chat order by the user's messages", () => {
  it("ignores agent activity and moves a chat when the user messages it", () => {
    const first = {
      id: "a",
      createdAt: 1,
      lastUserMessageAt: 3,
      updatedAt: 10,
    };
    const chats = [
      first,
      { id: "b", createdAt: 2, lastUserMessageAt: 4, updatedAt: 5 },
    ];
    expect(byLastUserMessage(chats).map((row) => row.id)).toEqual(["b", "a"]);
    first.updatedAt = 20;
    expect(byLastUserMessage(chats).map((row) => row.id)).toEqual(["b", "a"]);
    first.lastUserMessageAt = 6;
    expect(byLastUserMessage(chats).map((row) => row.id)).toEqual(["a", "b"]);
    expect(chats.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("keeps the given order for chats messaged at the same moment", () => {
    expect(
      byLastUserMessage([
        { id: "a", lastUserMessageAt: 1 },
        { id: "b", lastUserMessageAt: 3 },
        { id: "c", lastUserMessageAt: 3 },
      ]).map((row) => row.id),
    ).toEqual(["b", "c", "a"]);
  });
});

describe("the time at a row's end", () => {
  // A Wednesday afternoon.
  const now = new Date(2026, 8, 16, 14, 30);

  it.each([
    ["9:00 AM", new Date(2026, 8, 16, 9)],
    ["12:05 PM", new Date(2026, 8, 16, 12, 5)],
    ["Sep 15", new Date(2026, 8, 15, 23)],
    ["Sep 9", new Date(2026, 8, 9, 8)],
    ["Aug 14", new Date(2026, 7, 14, 8)],
    ["Dec 30, 2025", new Date(2025, 11, 30, 8)],
  ])("says %s", (label, date) => {
    expect(activityLabel(date, now)).toBe(label);
  });
});

describe("a draft's title", () => {
  it.each([
    ["the first line", "Guard the Nest\nbefore five", "Guard the Nest"],
    [
      "the first line that says anything",
      "\n  \n  Guard the Nest ",
      "Guard the Nest",
    ],
    ["a name for none", "", "New chat"],
    ["a name for only blank lines", " \n\t\n", "New chat"],
    [
      "the words as a person reads them, an app by its name",
      "Check [Gmail](instrument://app/gmail) for the invoice",
      "Check Gmail for the invoice",
    ],
    [
      "the words as a person reads them, a skill as its slash",
      "Use [$release](skill:release) to ship **this**",
      "Use /release to ship this",
    ],
  ])("is %s", (_, words, title) => {
    expect(draftTitle(words)).toBe(title);
  });
});

describe("wordRanges", () => {
  it.each<[string, string, null | number[]]>([
    ["Lisbon fares", "", null],
    ["Lisbon fares", "porto", null],
    ["Lisbon fares", "FARES", [7, 12]],
    ["Lisbon fares", "fares lis", [0, 3, 7, 12]],
    ["banana", "an", [1, 5]],
    ["banana", "ana nan", [1, 5]],
  ])("finds %j searched for %j", (text, search, ranges) => {
    expect(wordRanges(text, search)).toEqual(ranges);
  });
});

describe("a command menu search's ask of the projects", () => {
  it.each<[string, boolean, string]>([
    ["reading", false, "reading"],
    ["reading list", false, "reading list"],
    ["project", true, ""],
    ["Projects", true, ""],
    ["project reading", true, "reading"],
    ["reading project", true, "reading"],
    ["  reading   list projects ", true, "reading list"],
    ["project: reading", true, "reading"],
    // The word inside another is that other word.
    ["topical", false, "topical"],
    // A project with the word in its name is found by the rest of it.
    ["hot projects", true, "hot"],
    // Said twice, the second is part of the name.
    ["project project", true, "project"],
  ])("%j asks: %j, by the name %j", (words, isAsked, name) => {
    expect(projectSearch(words)).toEqual({ isAsked, name });
  });
});

describe("the rail's Chat dot", () => {
  const at = (
    overrides: Partial<{
      archived: boolean;
      status: Filterable["status"];
      unread: boolean;
      working: boolean;
    }> = {},
  ) => ({
    archived: false,
    status: "idle" as const,
    unread: false,
    working: false,
    ...overrides,
  });

  it.each<[string, ReturnType<typeof at>[], ReturnType<typeof railMarkOf>]>([
    ["no chats", [], undefined],
    ["every chat seen and at rest", [at(), at()], undefined],
    ["one unread", [at(), at({ unread: true })], "unread"],
    [
      "one working",
      [at({ unread: true }), at({ status: "working", working: true })],
      "working",
    ],
    // A card can wait on the user while a task of the chat works.
    ["a task working under a settled chat", [at({ working: true })], "working"],
    [
      "one waiting beside one working",
      [at({ status: "working", working: true }), at({ status: "waiting" })],
      "waiting",
    ],
    [
      "only put away chats",
      [at({ archived: true, status: "waiting", unread: true, working: true })],
      undefined,
    ],
  ])("%s: %j", (_label, chats, mark) => {
    expect(railMarkOf(chats)).toBe(mark);
    expect(
      strongestMark(chats.flatMap((each) => railMarkOf([each]) ?? [])),
    ).toBe(mark);
  });
});

describe("chatTabMark", () => {
  const ONE = ChatIdSchema.parse("2026-10-23-pricing-ab12");
  const OTHER = ChatIdSchema.parse("2026-10-23-quotes-cd34");
  const marks = new Map<ChatId, RailChatMark>([
    [ONE, "unread"],
    [OTHER, "waiting"],
  ]);

  it.each<
    [
      string,
      string,
      Map<ChatId, RailChatMark>,
      boolean,
      ReturnType<typeof chatTabMark>,
    ]
  >([
    [
      "an unread chat behind",
      chatHref(ONE),
      marks,
      false,
      { dot: "unread", isWorking: false },
    ],
    ["the same chat up", chatHref(ONE), marks, true, { isWorking: false }],
    [
      "a chat waiting behind",
      chatHref(OTHER),
      marks,
      false,
      { dot: "waiting", isWorking: false },
    ],
    [
      "a working chat up",
      chatHref(ONE),
      new Map([[ONE, "working"]]),
      true,
      { isWorking: true },
    ],
    ["the inbox", "/chats", marks, false, { isWorking: false }],
  ])("%s", (_label, href, chatMarks, isUp, expected) => {
    expect(chatTabMark(href, chatMarks, { isUp })).toEqual(expected);
  });
});
