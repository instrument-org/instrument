import { describe, expect, it } from "vitest";

import {
  activityLabel,
  appsUsed,
  askOf,
  basename,
  byActivity,
  chooseOnly,
  dayLabel,
  draftTitle,
  type Filterable,
  foldSection,
  hasWords,
  isInbox,
  matchesFilters,
  NO_FILTERS,
  type ThreadFilters,
} from "./threads";

function thread({
  holds,
  ...overrides
}: Partial<Omit<Filterable, "holds">> & {
  holds?: Partial<Filterable["holds"]>;
} = {}): Filterable {
  return {
    archived: false,
    holds: { apps: [], files: [], sites: [], ...holds },
    root: { parts: [] },
    state: "idle",
    title: "",
    topics: [],
    unread: 0,
    ...overrides,
  };
}

/** A thread with every kind of words a row shows, for the search to find. */
function wordyThread(): Filterable {
  return thread({
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

describe("matchesFilters", () => {
  it("narrows nothing with nothing set", () => {
    expect(matchesFilters(thread(), NO_FILTERS)).toBe(true);
  });

  it.each<[string, Partial<ThreadFilters>, Filterable, Filterable]>([
    ["unread replies", { place: "unread" }, thread({ unread: 2 }), thread()],
    [
      "the user to answer",
      { place: "needsYou" },
      thread({ state: "waiting" }),
      thread({ state: "working", unread: 2 }),
    ],
    [
      "been put away",
      { place: "archive" },
      thread({ archived: true }),
      thread({ unread: 2 }),
    ],
    [
      "a topic",
      { topics: ["house"] },
      thread({ topics: ["house", "money"] }),
      thread({ topics: ["money"] }),
    ],
    [
      "an app",
      { apps: ["gmail"] },
      thread({ holds: { apps: ["gmail"] } }),
      thread({ holds: { apps: ["github"] } }),
    ],
    [
      "the words",
      { search: "protein" },
      thread({ title: "Best priced protein drink" }),
      thread({ title: "MLS standings" }),
    ],
  ])("keeps what has %s and drops the rest", (_, group, kept, dropped) => {
    const filters = { ...NO_FILTERS, ...group };
    expect(matchesFilters(kept, filters)).toBe(true);
    expect(matchesFilters(dropped, filters)).toBe(false);
  });

  it("keeps a waiting thread among the unread only by its unread count", () => {
    const filters: ThreadFilters = { ...NO_FILTERS, place: "unread" };
    expect(matchesFilters(thread({ state: "waiting" }), filters)).toBe(false);
    expect(
      matchesFilters(thread({ state: "working", unread: 1 }), filters),
    ).toBe(true);
  });

  it("holds no thread in the drafts, since a draft is not a thread yet", () => {
    const filters: ThreadFilters = { ...NO_FILTERS, place: "drafts" };
    expect(matchesFilters(thread(), filters)).toBe(false);
    expect(matchesFilters(thread({ unread: 3 }), filters)).toBe(false);
    expect(matchesFilters(wordyThread(), filters, TOPIC_NAMES)).toBe(false);
  });

  it("keeps every thread not put away in the inbox, whatever it holds", () => {
    const filters: ThreadFilters = { ...NO_FILTERS, place: undefined };
    expect(matchesFilters(thread(), filters)).toBe(true);
    expect(matchesFilters(thread({ unread: 3 }), filters)).toBe(true);
    expect(matchesFilters(thread({ state: "waiting" }), filters)).toBe(true);
    expect(matchesFilters(thread({ archived: true }), filters)).toBe(false);
  });

  it.each<[string, ThreadFilters, Filterable]>([
    ["the unread", { ...NO_FILTERS, place: "unread" }, thread({ unread: 3 })],
    [
      "Needs you",
      { ...NO_FILTERS, place: "needsYou" },
      thread({ state: "waiting" }),
    ],
    [
      "a topic",
      { ...NO_FILTERS, topics: ["house"] },
      thread({ topics: ["house"] }),
    ],
    [
      "an app",
      { ...NO_FILTERS, apps: ["gmail"] },
      thread({ holds: { apps: ["gmail"] } }),
    ],
    [
      "the words",
      { ...NO_FILTERS, search: "protein" },
      thread({ title: "Protein drink" }),
    ],
  ])("leaves a thread put away out of %s", (_, filters, kept) => {
    expect(matchesFilters(kept, filters)).toBe(true);
    expect(matchesFilters({ ...kept, archived: true }, filters)).toBe(false);
  });

  it("holds only what was put away in the archive, narrowed by the search", () => {
    const filters: ThreadFilters = { ...NO_FILTERS, place: "archive" };
    expect(matchesFilters(thread({ archived: true, unread: 3 }), filters)).toBe(
      true,
    );
    expect(
      matchesFilters(thread({ archived: true, state: "waiting" }), filters),
    ).toBe(true);
    expect(matchesFilters(thread({ unread: 3 }), filters)).toBe(false);
    expect(
      matchesFilters(thread({ archived: true, title: "MLS standings" }), {
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
    expect(matchesFilters(wordyThread(), filters, TOPIC_NAMES)).toBe(true);
    expect(matchesFilters(thread(), filters, TOPIC_NAMES)).toBe(false);
  });

  it("wants every word searched for, wherever each turns up", () => {
    expect(
      matchesFilters(
        wordyThread(),
        { ...NO_FILTERS, search: "  chocolate  amazon " },
        TOPIC_NAMES,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        wordyThread(),
        { ...NO_FILTERS, search: "chocolate costco" },
        TOPIC_NAMES,
      ),
    ).toBe(false);
    expect(
      matchesFilters(thread(), { ...NO_FILTERS, search: "   " }, TOPIC_NAMES),
    ).toBe(true);
  });

  it("reads a pill only by a name it was given", () => {
    const filters = { ...NO_FILTERS, search: "shopping" };
    expect(matchesFilters(wordyThread(), filters)).toBe(false);
    expect(matchesFilters(wordyThread(), filters, TOPIC_NAMES)).toBe(true);
  });

  it("reads any row's words the same way, for the rows that are not threads", () => {
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
        thread({ holds: { apps: ["gmail"] }, topics: ["errands"] }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        thread({ holds: { apps: ["gmail"] }, topics: ["money"] }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchesFilters(
        thread({ holds: { apps: [] }, topics: ["house"] }),
        filters,
      ),
    ).toBe(false);
  });

  it("narrows a place by the search too", () => {
    const filters: ThreadFilters = {
      ...NO_FILTERS,
      place: "unread",
      search: "protein",
    };
    expect(
      matchesFilters(thread({ title: "Protein drink", unread: 1 }), filters),
    ).toBe(true);
    expect(
      matchesFilters(thread({ title: "MLS standings", unread: 1 }), filters),
    ).toBe(false);
    expect(matchesFilters(thread({ title: "Protein drink" }), filters)).toBe(
      false,
    );
  });
});

describe("what the column offers", () => {
  it("lists each app once", () => {
    expect(
      appsUsed([
        thread({ holds: { apps: ["gmail", "github"] } }),
        thread({ holds: { apps: ["gmail"] } }),
      ]),
    ).toEqual(["gmail", "github"]);
  });
});

describe("choosing a row of the column", () => {
  const searched = { ...NO_FILTERS, search: "fence" };

  it("turns the row on alone, whatever was on before", () => {
    expect(
      chooseOnly(
        { ...searched, apps: ["gmail"], place: "unread" },
        { group: "topics", id: "house" },
      ),
    ).toEqual({ ...searched, topics: ["house"] });
    expect(
      chooseOnly(
        { ...searched, apps: ["gmail"], topics: ["house"] },
        { group: "place", id: "unread" },
      ),
    ).toEqual({ ...searched, place: "unread" });
  });

  it("moves between rows of one section", () => {
    expect(
      chooseOnly(
        { ...searched, topics: ["house"] },
        { group: "topics", id: "money" },
      ),
    ).toEqual({ ...searched, topics: ["money"] });
    expect(
      chooseOnly(
        { ...searched, place: "unread" },
        { group: "place", id: "drafts" },
      ),
    ).toEqual({ ...searched, place: "drafts" });
  });

  it("moves between a topic and a place", () => {
    expect(
      chooseOnly(
        { ...searched, topics: ["house"] },
        { group: "place", id: "drafts" },
      ),
    ).toEqual({ ...searched, place: "drafts" });
    expect(
      chooseOnly(
        { ...searched, place: "drafts" },
        { group: "topics", id: "house" },
      ),
    ).toEqual({ ...searched, topics: ["house"] });
  });

  it("turns the chosen row off again, keeping the search", () => {
    expect(
      chooseOnly(
        { ...searched, apps: ["gmail"] },
        { group: "apps", id: "gmail" },
      ),
    ).toEqual(searched);
    expect(
      chooseOnly(
        { ...searched, place: "unread" },
        { group: "place", id: "unread" },
      ),
    ).toEqual(searched);
    expect(
      chooseOnly(
        { ...searched, place: "unread" },
        { group: "place", id: "unread" },
      ).place,
    ).toBeUndefined();
  });
});

describe("the inbox", () => {
  it("is where nothing is chosen, whatever the search says", () => {
    expect(isInbox(NO_FILTERS)).toBe(true);
    expect(isInbox({ ...NO_FILTERS, search: "fence" })).toBe(true);
  });

  it.each<[string, ThreadFilters]>([
    ["a place", { ...NO_FILTERS, place: "unread" }],
    ["what needs the user", { ...NO_FILTERS, place: "needsYou" }],
    ["the drafts", { ...NO_FILTERS, place: "drafts" }],
    ["the archive", { ...NO_FILTERS, place: "archive" }],
    ["a topic", { ...NO_FILTERS, topics: ["house"] }],
    ["an app", { ...NO_FILTERS, apps: ["gmail"] }],
  ])("is left once %s is chosen", (_, filters) => {
    expect(isInbox(filters)).toBe(false);
  });
});

describe("a folded section", () => {
  const entries = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const ids = (shown: { id: string }[]) => shown.map((entry) => entry.id);

  it("shows the first several and says how many more there are", () => {
    const { hidden, shown } = foldSection(entries, new Set(), 3);
    expect(ids(shown)).toEqual(["a", "b", "c"]);
    expect(hidden).toBe(2);
  });

  it("keeps a chosen row in reach past the fold, in its place", () => {
    const { hidden, shown } = foldSection(entries, new Set(["a", "e"]), 3);
    expect(ids(shown)).toEqual(["a", "b", "c", "e"]);
    expect(hidden).toBe(1);
  });

  it("folds nothing when the section fits", () => {
    const { hidden, shown } = foldSection(entries, new Set(), 5);
    expect(ids(shown)).toEqual(["a", "b", "c", "d", "e"]);
    expect(hidden).toBe(0);
  });
});

describe("the inbox's order", () => {
  it("puts the thread something last happened in at the top", () => {
    const threads = [
      { id: "b", updatedAt: new Date(2026, 8, 15, 8).getTime() },
      { id: "d", updatedAt: new Date(2026, 8, 16, 11).getTime() },
      { id: "a", updatedAt: new Date(2026, 8, 14, 8).getTime() },
      { id: "c", updatedAt: new Date(2026, 8, 16, 9).getTime() },
    ];
    expect(byActivity(threads).map((row) => row.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("leaves the list it was given as it was", () => {
    const threads = [
      { id: "a", updatedAt: 1 },
      { id: "b", updatedAt: 2 },
    ];
    const sorted = byActivity(threads);
    expect(sorted).not.toBe(threads);
    expect(threads.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("the time at a row's end", () => {
  // A Wednesday afternoon.
  const now = new Date(2026, 8, 16, 14, 30);

  it.each([
    ["9:00 AM", new Date(2026, 8, 16, 9)],
    ["12:05 PM", new Date(2026, 8, 16, 12, 5)],
    ["Tue", new Date(2026, 8, 15, 23)],
    ["Mon", new Date(2026, 8, 14, 8)],
    ["Sun", new Date(2026, 8, 13, 8)],
    ["Sat", new Date(2026, 8, 12, 8)],
    ["Fri", new Date(2026, 8, 11, 8)],
    ["Thu", new Date(2026, 8, 10, 8)],
    // A week back the weekday would name today, so it is a date.
    ["Sep 9", new Date(2026, 8, 9, 8)],
    ["Aug 14", new Date(2026, 7, 14, 8)],
    ["Dec 30, 2025", new Date(2025, 11, 30, 8)],
  ])("says %s", (label, date) => {
    expect(activityLabel(date, now)).toBe(label);
  });
});

describe("day heads", () => {
  const now = new Date(2026, 8, 16, 14, 30);

  it.each([
    ["Today", new Date(2026, 8, 16, 9)],
    ["Yesterday", new Date(2026, 8, 15, 23)],
    ["Monday", new Date(2026, 8, 14, 8)],
    ["Friday", new Date(2026, 8, 11, 8)],
    ["Thursday", new Date(2026, 8, 10, 8)],
    // A week back the weekday would name today, so it is a date.
    ["Sep 9", new Date(2026, 8, 9, 8)],
    ["Aug 14", new Date(2026, 7, 14, 8)],
    ["Dec 30, 2025", new Date(2025, 11, 30, 8)],
  ])("says %s", (label, date) => {
    expect(dayLabel(date, now)).toBe(label);
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
    ["a name for none", "", "New thread"],
    ["a name for only blank lines", " \n\t\n", "New thread"],
  ])("is %s", (_, words, title) => {
    expect(draftTitle(words)).toBe(title);
  });
});
