// The sections column beside the list and the head it gives way to over a
// narrow list: topic tiles that narrow the place stood in, places and app
// rows, and the unread count on the places that keep one.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterColumn, FilterHead } from "./filter-column";
import {
  type Filterable,
  NO_FILTERS,
  SECTION_SHOWN,
  type ThreadFilters,
  type Topic,
} from "./threads";

const HOUSE: Topic = {
  color: "#0f9d6e",
  createdAt: 1,
  emoji: "🏠",
  id: "house",
  name: "House",
};

const MONEY: Topic = {
  color: "#d4a017",
  createdAt: 2,
  emoji: "💸",
  id: "money",
  name: "Money",
};

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
    starred: false,
    state: "idle",
    title: "",
    topics: [],
    unread: 0,
    ...overrides,
  };
}

const THREADS = [
  thread({ holds: { apps: ["gmail"] }, topics: ["house"], unread: 2 }),
  thread({ topics: ["house"] }),
];

function renderColumn({
  filters = NO_FILTERS,
  shape = "column",
  threads = THREADS,
}: {
  filters?: ThreadFilters;
  shape?: "column" | "head";
  threads?: Filterable[];
} = {}) {
  const onFiltersChange = vi.fn();
  const onNew = vi.fn();
  const props = {
    appsBySlug: new Map([
      ["gmail", { name: "Gmail", site: "https://mail.google.com" }],
    ]),
    filters,
    onFiltersChange,
    onNew,
    onTopicDetails: vi.fn(),
    threads,
    topics: [HOUSE, MONEY],
  };
  renderWithProviders(
    shape === "column" ? (
      <FilterColumn {...props} />
    ) : (
      <FilterHead {...props} />
    ),
  );
  return {
    column: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNew,
  };
}

describe("FilterColumn", () => {
  it("opens a draft from New at its top", () => {
    const { column, onNew } = renderColumn();
    fireEvent.click(column.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("holds the topics as tiles first, then the places, then the apps past a rule, counting the unread on the inbox alone", () => {
    const { column } = renderColumn();
    expect(
      column.getAllByRole("region").map((section) => section.ariaLabel),
    ).toEqual(["Places", "Apps"]);
    expect(column.getByRole("toolbar", { name: "Topics" })).toBeTruthy();
    // The inbox is where the column stands with nothing chosen, and it
    // counts the one thread with replies not yet seen.
    expect(column.getByRole("button", { pressed: true }).textContent).toBe(
      "Inbox1",
    );
    expect(
      column
        .getAllByRole("button", { pressed: false })
        .map((row) => row.getAttribute("aria-label") ?? row.textContent),
    ).toEqual(["House", "Money", "Starred", "Drafts", "All", "Gmail"]);
  });

  it("counts the unread among the starred, keeps a thread put away out of the inbox's count, and offers no topic or app for it", () => {
    const { column } = renderColumn({
      threads: [
        thread({
          archived: true,
          holds: { apps: ["gmail"] },
          starred: true,
          state: "waiting",
          topics: ["house", "money"],
          unread: 2,
        }),
        thread({ starred: true, topics: ["house"], unread: 1 }),
        thread({ unread: 1 }),
      ],
    });
    expect(column.getByRole("button", { name: /Inbox/ }).textContent).toBe(
      "Inbox2",
    );
    expect(column.getByRole("button", { name: /Starred/ }).textContent).toBe(
      "Starred2",
    );
    expect(column.getByRole("button", { name: /^All/ }).textContent).toBe(
      "All",
    );
    expect(column.queryByRole("region", { name: "Apps" })).toBeNull();
    expect(column.queryByRole("button", { name: /Needs you/ })).toBeNull();
  });

  it("has no Unread place: the count on the inbox is what says so", () => {
    const { column } = renderColumn();
    expect(column.queryByRole("button", { name: /Unread/ })).toBeNull();
  });

  it("has no search of its own: that sits over the list", () => {
    renderColumn();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("stands in the inbox while a topic narrows it, and steps back to it from a place keeping the topic and the search", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: {
        ...NO_FILTERS,
        place: "starred",
        search: "fence",
        topics: ["house"],
      },
    });
    expect(column.getByRole("button", { name: /Inbox/ }).ariaPressed).toBe(
      "false",
    );
    expect(column.getByRole("button", { name: "House" }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(column.getByRole("button", { name: /Inbox/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
      topics: ["house"],
    });
  });

  it("narrows the place stood in to one topic from its tile: choosing moves, choosing again lifts it", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, place: "starred", topics: ["house"] },
    });
    fireEvent.click(column.getByRole("button", { name: "Money" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      topics: ["money"],
    });
    fireEvent.click(column.getByRole("button", { name: "House" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
    });
  });

  it("keeps the topic when a place is chosen, with the search apart from both", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    fireEvent.click(column.getByRole("button", { name: /Starred/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      search: "fence",
      topics: ["house"],
    });
  });

  it("stands in Needs you, which is a row only while something waits on the user, and in All", () => {
    const { column, onFiltersChange } = renderColumn({
      threads: [thread({ state: "waiting" })],
    });
    fireEvent.click(column.getByRole("button", { name: /Needs you/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "needsYou",
    });
    fireEvent.click(column.getByRole("button", { name: /All/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "all",
    });
  });

  it("steps out of a place by choosing it again", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, place: "starred" },
    });
    expect(column.getByRole("button", { name: /Starred/ }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(column.getByRole("button", { name: /Starred/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("makes no topic of its own: that happens from a thread's topic list", () => {
    const { column } = renderColumn();
    expect(column.queryByRole("button", { name: "New topic" })).toBeNull();
  });

  it("folds a long apps section behind a more row that opens it and a less row that folds it again", () => {
    const apps = Array.from(
      { length: SECTION_SHOWN + 2 },
      (_, index) => `app-${index}`,
    );
    const { column } = renderColumn({
      threads: apps.map((slug) => thread({ holds: { apps: [slug] } })),
    });
    const section = within(column.getByRole("region", { name: "Apps" }));
    expect(section.getAllByRole("button", { pressed: false })).toHaveLength(
      SECTION_SHOWN,
    );
    fireEvent.click(section.getByRole("button", { name: "2 more" }));
    expect(section.getAllByRole("button", { pressed: false })).toHaveLength(
      apps.length,
    );
    fireEvent.click(section.getByRole("button", { name: "Less" }));
    expect(section.getAllByRole("button", { pressed: false })).toHaveLength(
      SECTION_SHOWN,
    );
  });
});

describe("FilterHead", () => {
  it("puts the places on one line with the one stood in named and the inbox counting its unread, New at its end, and the topic tiles under them", () => {
    const { column, onFiltersChange, onNew } = renderColumn({
      filters: { ...NO_FILTERS, place: "starred" },
      shape: "head",
    });
    const places = within(column.getByRole("toolbar", { name: "Places" }));
    expect(
      places
        .getAllByRole("button")
        .map((mark) => [mark.getAttribute("aria-label"), mark.textContent]),
    ).toEqual([
      ["Inbox", "1"],
      ["Starred", "Starred"],
      ["Drafts", ""],
      ["All", ""],
      ["New", ""],
    ]);
    fireEvent.click(places.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledOnce();
    fireEvent.click(places.getByRole("button", { name: "Drafts" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "drafts",
    });
    const topics = within(column.getByRole("toolbar", { name: "Topics" }));
    fireEvent.click(topics.getByRole("button", { name: "House" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      topics: ["house"],
    });
    expect(column.queryByRole("region", { name: "Apps" })).toBeNull();
  });
});
