import { describe, expect, it } from "vitest";

import {
  appsUsed,
  askOf,
  basename,
  dayLabel,
  type Filterable,
  groupByDay,
  matchesFilters,
  NO_FILTERS,
  sitesByUse,
  type ThreadFilters,
} from "./threads";

function thread({
  holds,
  ...overrides
}: Partial<Omit<Filterable, "holds">> & {
  holds?: Partial<Filterable["holds"]>;
} = {}): Filterable {
  return {
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
    ["unread", { status: ["unread"] }, thread({ unread: 2 }), thread()],
    [
      "needs you",
      { status: ["needsYou"] },
      thread({ state: "waiting" }),
      thread({ state: "working" }),
    ],
    [
      "either state",
      { status: ["unread", "needsYou"] },
      thread({ state: "waiting" }),
      thread({ state: "idle" }),
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
      thread({ holds: { apps: ["gmail"], sites: [] } }),
      thread({ holds: { apps: ["github"], sites: [] } }),
    ],
    [
      "a site",
      { sites: ["amazon.com"] },
      thread({ holds: { apps: [], sites: ["amazon.com"] } }),
      thread({ holds: { apps: [], sites: [] } }),
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

  it("wants any of a group's choices and all of the groups", () => {
    const filters = {
      ...NO_FILTERS,
      apps: ["gmail"],
      topics: ["house", "errands"],
    };
    expect(
      matchesFilters(
        thread({ holds: { apps: ["gmail"], sites: [] }, topics: ["errands"] }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        thread({ holds: { apps: ["gmail"], sites: [] }, topics: ["money"] }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchesFilters(
        thread({ holds: { apps: [], sites: [] }, topics: ["house"] }),
        filters,
      ),
    ).toBe(false);
  });
});

describe("what the menus offer", () => {
  it("orders sites by how many threads went there, then by name", () => {
    expect(
      sitesByUse([
        thread({ holds: { apps: [], sites: ["zevia.com", "amazon.com"] } }),
        thread({ holds: { apps: [], sites: ["amazon.com"] } }),
        thread({ holds: { apps: [], sites: ["costco.com"] } }),
      ]),
    ).toEqual(["amazon.com", "costco.com", "zevia.com"]);
  });

  it("lists each app once", () => {
    expect(
      appsUsed([
        thread({ holds: { apps: ["gmail", "github"], sites: [] } }),
        thread({ holds: { apps: ["gmail"], sites: [] } }),
      ]),
    ).toEqual(["gmail", "github"]);
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

  it("groups oldest first, newest at the foot", () => {
    const groups = groupByDay(
      [
        { createdAt: new Date(2026, 8, 16, 9).getTime(), id: "c" },
        { createdAt: new Date(2026, 8, 14, 8).getTime(), id: "a" },
        { createdAt: new Date(2026, 8, 15, 8).getTime(), id: "b" },
        { createdAt: new Date(2026, 8, 16, 11).getTime(), id: "d" },
      ],
      now,
    );
    expect(
      groups.map(([label, rows]) => [label, rows.map((row) => row.id)]),
    ).toEqual([
      ["Monday", ["a"]],
      ["Yesterday", ["b"]],
      ["Today", ["c", "d"]],
    ]);
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
