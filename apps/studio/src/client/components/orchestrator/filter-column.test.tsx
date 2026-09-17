// The sections column at width and as the strip it shrinks to: places and
// rows that choose, marks that open a section's list, and a count where a
// row holds threads.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterColumn } from "./filter-column";
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
    holds: { apps: [], files: [], sites: [], ...holds },
    root: { parts: [] },
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
  threads = THREADS,
}: { filters?: ThreadFilters; threads?: Filterable[] } = {}) {
  const onFiltersChange = vi.fn();
  const onNew = vi.fn();
  const onNewTopic = vi.fn();
  renderWithProviders(
    <FilterColumn
      appsBySlug={
        new Map([["gmail", { name: "Gmail", site: "https://mail.google.com" }]])
      }
      filters={filters}
      onFiltersChange={onFiltersChange}
      onNew={onNew}
      onNewTopic={onNewTopic}
      onTopicDetails={vi.fn()}
      threads={threads}
      topics={[HOUSE, MONEY]}
    />,
  );
  return {
    column: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNew,
    onNewTopic,
    strip: within(screen.getByRole("toolbar", { name: "Filter marks" })),
  };
}

describe("FilterColumn", () => {
  it("opens a draft from New at its top, and from the strip's first mark", () => {
    const { column, onNew, strip } = renderColumn();
    fireEvent.click(column.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledOnce();
    fireEvent.click(strip.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledTimes(2);
  });

  it("lists the places, then Topics and Apps, counting what a row holds and nothing where it holds nothing", () => {
    const { column } = renderColumn();
    expect(
      column.getAllByRole("region").map((section) => section.ariaLabel),
    ).toEqual(["Places", "Topics", "Apps"]);
    // The inbox is where the column stands with nothing chosen.
    expect(column.getByRole("button", { pressed: true }).textContent).toBe(
      "Inbox2",
    );
    expect(
      column
        .getAllByRole("button", { pressed: false })
        .map((row) => row.textContent),
    ).toEqual(["Unread1", "Drafts", "Archive", "🏠House2", "💸Money", "Gmail"]);
  });

  it("has no search of its own: that sits over the list", () => {
    renderColumn();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("steps back out to the inbox from its row, keeping the search", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    expect(column.getByRole("button", { name: /Inbox/ }).ariaPressed).toBe(
      "false",
    );
    expect(column.getByRole("button", { name: /^House/ }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(column.getByRole("button", { name: /Inbox/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
    });
  });

  it("stands in one topic at a time: choosing moves, choosing again clears", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, topics: ["house"] },
    });
    fireEvent.click(column.getByRole("button", { name: /^Money/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      topics: ["money"],
    });
    fireEvent.click(column.getByRole("button", { name: /^House/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("is one radio group across the places and the sections, with the search apart from it", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    fireEvent.click(column.getByRole("button", { name: /Unread/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "unread",
      search: "fence",
    });
  });

  it("steps out of a place by choosing it again", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, place: "unread" },
    });
    expect(column.getByRole("button", { name: /Unread/ }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(column.getByRole("button", { name: /Unread/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("opens the new-topic dialog from the plus on the Topics head", () => {
    const { column, onNewTopic } = renderColumn();
    fireEvent.click(column.getByRole("button", { name: "New topic" }));
    expect(onNewTopic).toHaveBeenCalledOnce();
  });

  it("folds a long section behind a more row that opens it and a less row that folds it again", () => {
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

  it("opens the section's list beside a mark of the strip, where the choice is the same one", () => {
    const { onFiltersChange, strip } = renderColumn({
      filters: { ...NO_FILTERS, topics: ["house"] },
    });
    const house = strip.getByRole("button", { name: "House" });
    expect(house.dataset.chosen).toBe("true");
    expect(strip.getByRole("button", { name: "Money" }).dataset.chosen).toBe(
      undefined,
    );
    fireEvent.click(house);
    const list = screen.getByRole("menu");
    expect(
      within(list)
        .getAllByRole("menuitemcheckbox")
        .map((row) => [row.textContent, row.ariaChecked]),
    ).toEqual([
      ["🏠House", "true"],
      ["💸Money", "false"],
    ]);
    fireEvent.click(
      within(list).getByRole("menuitemcheckbox", { name: "Money" }),
    );
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      topics: ["money"],
    });
  });

  it("turns a place straight from its mark in the strip, with no list to open", () => {
    const { onFiltersChange, strip } = renderColumn({
      filters: { ...NO_FILTERS, place: "unread" },
    });
    expect(strip.getByRole("button", { name: "Unread" }).dataset.chosen).toBe(
      "true",
    );
    expect(strip.getByRole("button", { name: "Inbox" }).dataset.chosen).toBe(
      undefined,
    );
    fireEvent.click(strip.getByRole("button", { name: "Inbox" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
