import { describe, expect, it } from "vitest";

import {
  activityLabel,
  askOf,
  basename,
  byActivity,
  type ChatFilters,
  choose,
  draftTitle,
  type Filterable,
  hasWords,
  isInbox,
  matchesFilters,
  NO_FILTERS,
  outsideFilters,
  widenToSearch,
  wordRanges,
} from "./chats";

function chat({
  holds,
  ...overrides
}: Partial<Omit<Filterable, "holds">> & {
  holds?: Partial<Filterable["holds"]>;
} = {}): Filterable {
  return {
    archived: false,
    holds: { apps: [], files: [], sites: [], ...holds },
    root: { parts: [] },
    starred: false,
    state: "idle",
    title: "",
    topics: [],
    unread: false,
    ...overrides,
  };
}

/** A chat with every kind of words a row shows, for the search to find. */
function wordyChat(): Filterable {
  return chat({
    holds: {
      apps: ["gmail"],
      files: ["/task/out/Protein-Report.md"],
      sites: ["amazon.com"],
    },
    latest: { text: "Ready to drink, chocolate first." },
    root: {
      parts: [{ text: "Find the best RTD protein drink", type: "text" }],
    },
    title: "Best priced protein drink",
    topics: ["shopping"],
  });
}

const TOPIC_NAMES = new Map([["shopping", "Shopping"]]);

describe("outsideFilters", () => {
  const chats = [
    wordyChat(),
    chat({ archived: true, title: "Protein powder returns" }),
    chat({ title: "Protein bars", topics: ["house"] }),
    chat({ title: "Roof repair" }),
  ];

  it("counts the chats the words find that the place and the topic keep out", () => {
    // The inbox hides the archived one; a topic hides the one filed elsewhere.
    expect(
      outsideFilters(chats, { ...NO_FILTERS, search: "protein" }, TOPIC_NAMES),
    ).toBe(1);
    expect(
      outsideFilters(
        chats,
        { ...NO_FILTERS, search: "protein", topics: ["shopping"] },
        TOPIC_NAMES,
      ),
    ).toBe(2);
    expect(
      outsideFilters(
        chats,
        { ...NO_FILTERS, place: "all", search: "protein" },
        TOPIC_NAMES,
      ),
    ).toBe(0);
  });

  it("counts nothing when nothing is searched for, whatever the filters hide", () => {
    expect(outsideFilters(chats, { ...NO_FILTERS, topics: ["house"] })).toBe(0);
  });

  it("widens to the same words over every chat", () => {
    expect(
      widenToSearch({
        apps: ["gmail"],
        place: "unread",
        search: "protein",
        topics: ["shopping"],
      }),
    ).toEqual({ apps: [], place: "all", search: "protein", topics: [] });
  });
});

describe("matchesFilters", () => {
  it("narrows nothing with nothing set", () => {
    expect(matchesFilters(chat(), NO_FILTERS)).toBe(true);
  });

  it.each<[string, Partial<ChatFilters>, Filterable, Filterable]>([
    [
      "replies not yet seen",
      { place: "unread" },
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
      { place: "starred" },
      chat({ archived: true, starred: true }),
      chat({ unread: true }),
    ],
    [
      "a topic",
      { topics: ["house"] },
      chat({ topics: ["house", "money"] }),
      chat({ topics: ["money"] }),
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
    expect(matchesFilters(wordyChat(), filters, TOPIC_NAMES)).toBe(false);
  });

  it("keeps every chat not put away in the inbox, whatever it holds", () => {
    const filters: ChatFilters = { ...NO_FILTERS, place: undefined };
    expect(matchesFilters(chat(), filters)).toBe(true);
    expect(matchesFilters(chat({ unread: true }), filters)).toBe(true);
    expect(matchesFilters(chat({ state: "waiting" }), filters)).toBe(true);
    expect(matchesFilters(chat({ archived: true }), filters)).toBe(false);
  });

  it.each<[string, ChatFilters, Filterable]>([
    ["Unread", { ...NO_FILTERS, place: "unread" }, chat({ unread: true })],
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

  it("keeps a chat put away in a topic it is filed under, as a label does", () => {
    const filters: ChatFilters = { ...NO_FILTERS, topics: ["house"] };
    expect(
      matchesFilters(chat({ archived: true, topics: ["house"] }), filters),
    ).toBe(true);
    expect(
      matchesFilters(chat({ archived: true, topics: ["garden"] }), filters),
    ).toBe(false);
  });

  it("holds every chat in All, put away or not, narrowed by the search", () => {
    const filters: ChatFilters = { ...NO_FILTERS, place: "all" };
    expect(
      matchesFilters(chat({ archived: true, unread: true }), filters),
    ).toBe(true);
    expect(
      matchesFilters(chat({ archived: true, state: "waiting" }), filters),
    ).toBe(true);
    expect(matchesFilters(chat({ unread: true }), filters)).toBe(true);
    expect(
      matchesFilters(chat({ archived: true, title: "MLS standings" }), {
        ...filters,
        search: "protein",
      }),
    ).toBe(false);
  });

  it.each([
    ["the title", "priced"],
    ["the ask", "rtd"],
    ["the latest line", "chocolate"],
    ["a topic's name", "shopping"],
    ["a file's name", "protein-report"],
    ["a site", "amazon"],
    ["an app", "gmail"],
  ])("finds a word in %s, whatever its case", (_, search) => {
    const filters = { ...NO_FILTERS, search: search.toUpperCase() };
    expect(matchesFilters(wordyChat(), filters, TOPIC_NAMES)).toBe(true);
    expect(matchesFilters(chat(), filters, TOPIC_NAMES)).toBe(false);
  });

  it("wants every word searched for, wherever each turns up", () => {
    expect(
      matchesFilters(
        wordyChat(),
        { ...NO_FILTERS, search: "  chocolate  amazon " },
        TOPIC_NAMES,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        wordyChat(),
        { ...NO_FILTERS, search: "chocolate costco" },
        TOPIC_NAMES,
      ),
    ).toBe(false);
    expect(
      matchesFilters(chat(), { ...NO_FILTERS, search: "   " }, TOPIC_NAMES),
    ).toBe(true);
  });

  it("reads a pill only by a name it was given", () => {
    const filters = { ...NO_FILTERS, search: "shopping" };
    expect(matchesFilters(wordyChat(), filters)).toBe(false);
    expect(matchesFilters(wordyChat(), filters, TOPIC_NAMES)).toBe(true);
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
      topics: ["house", "errands"],
    };
    expect(
      matchesFilters(
        chat({ holds: { apps: ["gmail"] }, topics: ["errands"] }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        chat({ holds: { apps: ["gmail"] }, topics: ["money"] }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchesFilters(chat({ holds: { apps: [] }, topics: ["house"] }), filters),
    ).toBe(false);
  });

  it("narrows a place by the search too", () => {
    const filters: ChatFilters = {
      ...NO_FILTERS,
      place: "starred",
      search: "protein",
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

describe("choosing a row of the column", () => {
  const searched = { ...NO_FILTERS, search: "fence" };

  it("shows one view at a time: a topic leaves the place, and a place the topic", () => {
    expect(
      choose(
        { ...searched, apps: ["gmail"], place: "starred" },
        { group: "topics", id: "house" },
      ),
    ).toEqual({ ...searched, topics: ["house"] });
    expect(
      choose(
        { ...searched, topics: ["house"] },
        { group: "place", id: "drafts" },
      ),
    ).toEqual({ ...searched, place: "drafts" });
  });

  it("moves between rows of one section", () => {
    expect(
      choose(
        { ...searched, topics: ["house"] },
        { group: "topics", id: "money" },
      ),
    ).toEqual({ ...searched, topics: ["money"] });
    expect(
      choose(
        { ...searched, place: "starred" },
        { group: "place", id: "drafts" },
      ),
    ).toEqual({ ...searched, place: "drafts" });
  });

  it("moves between a topic and an app", () => {
    expect(
      choose(
        { ...searched, topics: ["house"] },
        { group: "apps", id: "gmail" },
      ),
    ).toEqual({ ...searched, apps: ["gmail"] });
  });

  it("steps back to the inbox from the row already on, keeping the search", () => {
    expect(
      choose({ ...searched, apps: ["gmail"] }, { group: "apps", id: "gmail" }),
    ).toEqual(searched);
    expect(
      choose(
        { ...searched, place: "starred" },
        { group: "place", id: "starred" },
      ),
    ).toEqual(searched);
    expect(
      choose(
        { ...searched, topics: ["house"] },
        { group: "topics", id: "house" },
      ),
    ).toEqual(searched);
  });
});

describe("the inbox", () => {
  it("is where no place is chosen, whatever the search or a topic says", () => {
    expect(isInbox(NO_FILTERS)).toBe(true);
    expect(isInbox({ ...NO_FILTERS, search: "fence" })).toBe(true);
    expect(isInbox({ ...NO_FILTERS, topics: ["house"] })).toBe(true);
    expect(isInbox({ ...NO_FILTERS, apps: ["gmail"] })).toBe(true);
  });

  it.each<[string, ChatFilters]>([
    ["the unread", { ...NO_FILTERS, place: "unread" }],
    ["the starred", { ...NO_FILTERS, place: "starred" }],
    ["the drafts", { ...NO_FILTERS, place: "drafts" }],
    ["all of it", { ...NO_FILTERS, place: "all" }],
  ])("is left once %s is chosen", (_, filters) => {
    expect(isInbox(filters)).toBe(false);
  });
});

describe("the inbox's order", () => {
  it("puts the chat something last happened in at the top", () => {
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

describe("the ask", () => {
  it("is the words of the root's text parts", () => {
    expect(
      askOf({
        root: {
          parts: [
            { type: "data-attachments" },
            { text: "Find the receipt", type: "text" },
            { text: "and file it", type: "text" },
          ],
        },
      }),
    ).toBe("Find the receipt\nand file it");
  });

  it("names a file by its last segment", () => {
    expect(basename("/task/output/report.md")).toBe("report.md");
    expect(basename("report.md")).toBe("report.md");
    expect(basename("/mnt/home/notes/")).toBe("notes");
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
