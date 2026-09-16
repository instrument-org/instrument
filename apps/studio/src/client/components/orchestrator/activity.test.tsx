import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  type ActivityEntry,
  collapseVisits,
  groupRowsByDay,
  lookedText,
  matchesActivityFilters,
  mergeRows,
  NO_ACTIVITY_FILTERS,
  rowTarget,
  type Visit,
  visitsOf,
} from "./activity";

const THREAD = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const MINUTE = 60 * 1000;
const NOON = Date.UTC(2026, 8, 16, 12, 0);

function entry(
  overrides: Partial<ActivityEntry> & Pick<ActivityEntry, "at" | "kind">,
): ActivityEntry {
  return {
    id: `${THREAD}:msg:${overrides.kind}`,
    text: overrides.kind,
    thread: { id: THREAD, title: "Groceries", topics: [] },
    ...overrides,
  };
}

function file(
  name: string,
  minute: number,
  folder = "/Users/sam/Downloads",
): Visit {
  return {
    at: NOON + minute * MINUTE,
    folder,
    kind: "file",
    target: {
      href: `/orchestrator/computer?file=${folder}/${name}`,
      kind: "screen",
    },
    title: name,
  };
}

function page(url: string, minute: number): Visit {
  return {
    at: NOON + minute * MINUTE,
    kind: "page",
    target: { kind: "page", url },
    title: url,
  };
}

describe("collapseVisits", () => {
  it("runs visits within ten minutes of each other together, newest first", () => {
    const rows = collapseVisits([
      file("a.md", 0),
      file("b.md", 4),
      file("c.md", 12),
      page("https://example.com", 40),
      file("d.md", 45),
    ]);
    expect(
      rows.map((row) =>
        row.kind === "looked" ? row.visits.map((visit) => visit.title) : [],
      ),
    ).toEqual([
      ["d.md", "https://example.com"],
      ["c.md", "b.md", "a.md"],
    ]);
  });

  it("keys a run by the visit it started with, so a newer visit joining it keeps the key", () => {
    const before = collapseVisits([file("a.md", 0), file("b.md", 4)]);
    const after = collapseVisits([
      file("a.md", 0),
      file("b.md", 4),
      file("c.md", 8),
    ]);
    expect(after[0]?.id).toBe(before[0]?.id);
  });
});

describe("lookedText", () => {
  it("names one visit, counts a run, and says where the files were", () => {
    expect(lookedText([file("a.md", 0)])).toBe("a.md");
    expect(lookedText([file("a.md", 0), file("b.md", 1)])).toBe(
      "2 files in Downloads",
    );
    expect(
      lookedText([file("a.md", 0), file("b.md", 1, "/Users/sam/Desktop")]),
    ).toBe("2 files");
    expect(
      lookedText([
        file("a.md", 0),
        page("https://example.com", 1),
        page("https://example.org", 2),
        { ...page("x", 3), kind: "task", title: "Grocery list" },
      ]),
    ).toBe("a file, 2 pages, and a task");
  });
});

describe("visitsOf", () => {
  it("reads a file's folder off its address, and leaves Activity itself out", () => {
    const visits = visitsOf(
      [
        {
          at: NOON,
          href: "/orchestrator/computer?file=%2FUsers%2Fsam%2FDownloads%2Fa.md&path=&root=~",
          kind: "file",
          title: "a.md",
        },
        { at: NOON, href: "/orchestrator/activity", kind: "task", title: "x" },
      ],
      [{ at: NOON, title: "", url: "https://example.com/a" }],
    );
    expect(
      visits.map((visit) => [visit.kind, visit.title, visit.folder]),
    ).toEqual([
      ["file", "a.md", "/Users/sam/Downloads"],
      ["page", "example.com", undefined],
    ]);
  });
});

describe("mergeRows", () => {
  it("interleaves the threads' entries with the window's visits, newest first", () => {
    const rows = mergeRows(
      [
        entry({ at: NOON + 5 * MINUTE, kind: "replied" }),
        entry({ at: NOON, kind: "asked" }),
      ],
      [file("a.md", 2)],
    );
    expect(
      rows.map((row) => (row.kind === "entry" ? row.entry.kind : "looked")),
    ).toEqual(["replied", "looked", "asked"]);
  });
});

describe("matchesActivityFilters", () => {
  const asked = {
    at: NOON,
    entry: entry({ at: NOON, kind: "asked" }),
    id: "a",
    kind: "entry" as const,
  };
  const opened = {
    at: NOON,
    entry: entry({
      at: NOON,
      kind: "openedPage",
      marks: { sites: ["example.com"] },
      thread: { id: THREAD, title: "Groceries", topics: ["top_home"] },
    }),
    id: "o",
    kind: "entry" as const,
  };
  const looked = {
    at: NOON,
    id: "l",
    kind: "looked" as const,
    visits: [page("https://example.com/x", 0)],
  };

  it("splits the record by side: the user's asks and looks, or everything Instrument did", () => {
    const you = { ...NO_ACTIVITY_FILTERS, who: "you" as const };
    expect(matchesActivityFilters(asked, you)).toBe(true);
    expect(matchesActivityFilters(looked, you)).toBe(true);
    expect(matchesActivityFilters(opened, you)).toBe(false);
    const instrument = { ...NO_ACTIVITY_FILTERS, who: "instrument" as const };
    expect(matchesActivityFilters(asked, instrument)).toBe(false);
    expect(matchesActivityFilters(looked, instrument)).toBe(false);
    expect(matchesActivityFilters(opened, instrument)).toBe(true);
  });

  it("reads sites off what an entry opened and off the pages a run showed", () => {
    const sites = { ...NO_ACTIVITY_FILTERS, sites: ["example.com"] };
    expect(matchesActivityFilters(opened, sites)).toBe(true);
    expect(matchesActivityFilters(looked, sites)).toBe(true);
    expect(matchesActivityFilters(asked, sites)).toBe(false);
  });

  it("keeps a run of visits out of a topic, since it is in no thread", () => {
    const topics = { ...NO_ACTIVITY_FILTERS, topics: ["top_home"] };
    expect(matchesActivityFilters(opened, topics)).toBe(true);
    expect(matchesActivityFilters(looked, topics)).toBe(false);
  });
});

describe("rowTarget", () => {
  it("opens the thread, or the task when the entry is about one, or the run's newest visit", () => {
    expect(
      rowTarget({
        at: NOON,
        entry: entry({ at: NOON, kind: "replied" }),
        id: "r",
        kind: "entry",
      }),
    ).toEqual({
      href: `/orchestrator/threads/${THREAD}`,
      kind: "screen",
    });
    expect(
      rowTarget({
        at: NOON,
        entry: entry({
          at: NOON,
          kind: "taskFinished",
          taskId: TaskIdSchema.parse("grocery-list"),
        }),
        id: "t",
        kind: "entry",
      }),
    ).toEqual({ href: "/orchestrator/tasks/grocery-list", kind: "screen" });
    expect(
      rowTarget({
        at: NOON,
        id: "l",
        kind: "looked",
        visits: [file("a.md", 0), file("b.md", 1)],
      }),
    ).toEqual(file("a.md", 0).target);
  });
});

describe("groupRowsByDay", () => {
  it("heads the rows by day, newest first", () => {
    const now = new Date(NOON + 6 * 60 * MINUTE);
    const rows = mergeRows(
      [
        entry({ at: NOON, kind: "asked" }),
        entry({ at: NOON - 24 * 60 * MINUTE, kind: "asked" }),
        entry({ at: NOON - 3 * 24 * 60 * MINUTE, kind: "asked" }),
      ],
      [],
    );
    expect(
      groupRowsByDay(rows, now).map(([label, group]) => [label, group.length]),
    ).toEqual([
      ["Today", 1],
      ["Yesterday", 1],
      ["Sunday", 1],
    ]);
  });
});
