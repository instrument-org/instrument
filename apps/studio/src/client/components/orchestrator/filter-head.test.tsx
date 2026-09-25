// The line over the inbox: the view picker (the chats or a topic) and the
// places beside it, one view at a time.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterHead } from "./filter-head";
import {
  type Filterable,
  NO_FILTERS,
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

/** The picker is a popover, which Radix opens on click. */
function openPicker(picker: HTMLElement) {
  fireEvent.click(picker);
}

function renderHead({
  filters = NO_FILTERS,
  threads = THREADS,
  topics = [HOUSE, MONEY],
}: {
  filters?: ThreadFilters;
  threads?: Filterable[];
  topics?: Topic[];
} = {}) {
  const onFiltersChange = vi.fn();
  const onNewTopic = vi.fn();
  renderWithProviders(
    <FilterHead
      filters={filters}
      onFiltersChange={onFiltersChange}
      onNewTopic={onNewTopic}
      onTopicDetails={vi.fn()}
      threads={threads}
      topics={topics}
    />,
  );
  return {
    head: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNewTopic,
    places: within(screen.getByRole("toolbar", { name: "Places" })),
  };
}

describe("FilterHead", () => {
  it("heads the line with the chats, their unread counted only in the open picker, and the places beside it", () => {
    const { head, places } = renderHead();
    const picker = head.getByRole("button", { name: "View: Chats" });
    expect(picker.textContent).toBe("Chats");
    openPicker(picker);
    expect(
      screen.getByRole("menuitemradio", { name: "Chats" }).parentElement
        ?.textContent,
    ).toBe("Chats1");
    expect(
      places
        .getAllByRole("button")
        .map((mark) => mark.getAttribute("aria-label")),
    ).toEqual(["Starred", "Drafts", "All"]);
  });

  it("counts the unread among the starred, keeps a thread put away out of the chats' count, and offers Needs you only while something waits", () => {
    const { head, places } = renderHead({
      threads: [
        thread({ starred: true, unread: 1 }),
        thread({ archived: true, unread: 3 }),
        thread({ state: "waiting" }),
      ],
    });
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    expect(
      screen.getByRole("menuitemradio", { name: "Chats" }).parentElement
        ?.textContent,
    ).toBe("Chats1");
    expect(places.getByRole("button", { name: "Starred" }).textContent).toBe(
      "1",
    );
    expect(places.getByRole("button", { name: "Needs you" })).toBeTruthy();
  });

  it("stands in one place at a time, leaving the topic, and steps back to the chats from it", () => {
    const { onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    fireEvent.click(places.getByRole("button", { name: "Drafts" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "drafts",
      search: "fence",
    });
  });

  it("steps out of a place by choosing it again", () => {
    const { onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, place: "starred" },
    });
    fireEvent.click(places.getByRole("button", { name: "Starred" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("names the place that is the view, and steps the chats back to a mark that returns to them", () => {
    const { head, onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, place: "drafts" },
    });
    expect(places.getByRole("button", { name: "Drafts" }).textContent).toBe(
      "Drafts",
    );
    fireEvent.click(head.getByRole("button", { name: "Chats" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("picks a topic from the picker, keeping the search", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, search: "fence" },
    });
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Money/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
      topics: ["money"],
    });
  });

  it("goes back to the chats from a topic through the picker", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, topics: ["house"] },
    });
    openPicker(head.getByRole("button", { name: "View: House" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Chats" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("makes a topic from the picker's foot, through the caller's dialog", () => {
    const { head, onNewTopic } = renderHead();
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "New topic" }));
    expect(onNewTopic).toHaveBeenCalledOnce();
  });
});
