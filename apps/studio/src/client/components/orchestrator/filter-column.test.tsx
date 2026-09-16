// The filter column at width and as the strip it shrinks to: rows that
// choose, marks that open the section's list, and a count only where a
// state has one.
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
  thread({ holds: { apps: ["gmail"], sites: ["www.amazon.com"] } }),
  thread({ holds: { sites: ["www.amazon.com"] } }),
];

function renderColumn({
  filters = NO_FILTERS,
  threads = THREADS,
}: { filters?: ThreadFilters; threads?: Filterable[] } = {}) {
  const onFiltersChange = vi.fn();
  const onNewTopic = vi.fn();
  renderWithProviders(
    <FilterColumn
      appsBySlug={
        new Map([["gmail", { name: "Gmail", site: "https://mail.google.com" }]])
      }
      filters={filters}
      onFiltersChange={onFiltersChange}
      onNewTopic={onNewTopic}
      onTopicDetails={vi.fn()}
      threads={threads}
      topics={[HOUSE, MONEY]}
    />,
  );
  return {
    column: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNewTopic,
    strip: within(screen.getByRole("toolbar", { name: "Filter marks" })),
  };
}

describe("FilterColumn", () => {
  it("lists Status, Topics, Apps, and Sites as rows, with no count on any of them", () => {
    const { column } = renderColumn();
    expect(
      column.getAllByRole("region").map((section) => section.ariaLabel),
    ).toEqual(["Status", "Topics", "Apps", "Sites"]);
    expect(
      column
        .getAllByRole("button", { pressed: false })
        .map((row) => row.textContent),
    ).toEqual([
      "Unread",
      "Needs you",
      "🏠House",
      "💸Money",
      "Gmail",
      "amazon.com",
    ]);
    expect(
      screen.getByRole("group", { name: "Filters" }).textContent,
    ).not.toMatch(/\d/);
  });

  it("counts the threads in a state on its row alone, and only above zero", () => {
    const { column } = renderColumn({
      threads: [
        thread({ unread: 2 }),
        thread({ holds: { sites: ["www.amazon.com"] }, unread: 1 }),
        thread({ holds: { sites: ["www.amazon.com"] } }),
      ],
    });
    expect(column.getByRole("button", { name: /Unread/ }).textContent).toBe(
      "Unread2",
    );
    expect(column.getByRole("button", { name: "Needs you" }).textContent).toBe(
      "Needs you",
    );
    expect(column.getByRole("button", { name: "amazon.com" }).textContent).toBe(
      "amazon.com",
    );
  });

  it("stands in one topic at a time: choosing moves, choosing again clears", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, topics: ["house"] },
    });
    expect(column.getByRole("button", { name: "House" }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(column.getByRole("button", { name: "Money" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      topics: ["money"],
    });
    fireEvent.click(column.getByRole("button", { name: "House" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      topics: [],
    });
  });

  it("is one radio group across its sections, with the search apart from it", () => {
    const { column, onFiltersChange } = renderColumn({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    fireEvent.click(column.getByRole("button", { name: "Needs you" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
      status: ["needsYou"],
    });
  });

  it("opens the new-topic dialog from the plus on the Topics head", () => {
    const { column, onNewTopic } = renderColumn();
    fireEvent.click(column.getByRole("button", { name: "New topic" }));
    expect(onNewTopic).toHaveBeenCalledOnce();
  });

  it("folds a long section behind a more row that opens it and a less row that folds it again", () => {
    const sites = Array.from(
      { length: SECTION_SHOWN + 2 },
      (_, index) => `site-${index}.com`,
    );
    const { column } = renderColumn({
      threads: sites.map((site) => thread({ holds: { sites: [site] } })),
    });
    const section = within(column.getByRole("region", { name: "Sites" }));
    expect(section.getAllByRole("button", { pressed: false })).toHaveLength(
      SECTION_SHOWN,
    );
    fireEvent.click(section.getByRole("button", { name: "2 more" }));
    expect(section.getAllByRole("button", { pressed: false })).toHaveLength(
      sites.length,
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

  it("stands every site behind one globe, tinted once a site is chosen", () => {
    const { strip } = renderColumn({
      filters: { ...NO_FILTERS, sites: ["www.amazon.com"] },
    });
    expect(strip.queryByRole("button", { name: "amazon.com" })).toBeNull();
    expect(strip.getByRole("button", { name: "Sites" }).dataset.chosen).toBe(
      "true",
    );
  });
});
