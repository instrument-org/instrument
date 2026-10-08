// The line over the inbox: one picker over the views and the topics, and the
// search beside it, one view at a time.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type ChatFilters,
  type Filterable,
  NO_FILTERS,
  type Topic,
} from "./chats";
import { FilterHead } from "./filter-head";

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
    unread: 0,
    ...overrides,
  };
}

const CHATS = [
  chat({ holds: { apps: ["gmail"] }, topics: ["house"], unread: 2 }),
  chat({ topics: ["house"] }),
];

/** The picker is a popover, which Radix opens on click. */
function openPicker(picker: HTMLElement) {
  fireEvent.click(picker);
}

function renderHead({
  chats = CHATS,
  drafts = 0,
  filters = NO_FILTERS,
  topics = [HOUSE, MONEY],
}: {
  chats?: Filterable[];
  drafts?: number;
  filters?: ChatFilters;
  topics?: Topic[];
} = {}) {
  const onFiltersChange = vi.fn();
  const onNewTopic = vi.fn();
  renderWithProviders(
    <FilterHead
      chats={chats}
      drafts={drafts}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onNewTopic={onNewTopic}
      onTopicDetails={vi.fn()}
      topics={topics}
    />,
  );
  return {
    head: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNewTopic,
  };
}

/** Each row of the open picker with what stands at its end, in order. */
function pickerRows() {
  return screen
    .getAllByRole("menuitemradio")
    .map((row) => row.parentElement?.textContent);
}

describe("FilterHead", () => {
  it("lists the views, then the topics, each with how many chats it holds", () => {
    const { head } = renderHead({
      chats: [
        chat({ starred: true, topics: ["house"], unread: 1 }),
        chat({ archived: true, topics: ["house"], unread: 3 }),
        chat({ state: "waiting" }),
      ],
    });
    const picker = head.getByRole("button", { name: "View: Chats" });
    expect(picker.textContent).toBe("Chats");
    openPicker(picker);
    expect(pickerRows()).toEqual([
      "Chats",
      "Unread1",
      "Starred1",
      "Archived",
      "🏠House2",
      "💸Money",
      "New topic",
    ]);
  });

  it("offers Drafts only while there are some", () => {
    const { head } = renderHead({ drafts: 2 });
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    expect(
      screen.getByRole("menuitemradio", { name: "Drafts" }).parentElement
        ?.textContent,
    ).toBe("Drafts2");
  });

  it("stands in one view at a time, leaving the topic and keeping the search", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    openPicker(head.getByRole("button", { name: "View: House" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Starred" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      search: "fence",
    });
  });

  it("names the view on the picker and in the search, and steps back to the chats from it", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, place: "archived" },
    });
    expect(head.getByRole("textbox").getAttribute("placeholder")).toBe(
      "Search Archived",
    );
    openPicker(head.getByRole("button", { name: "View: Archived" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Chats" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("draws the picker in to its mark while the search is in use", () => {
    const { head } = renderHead({
      filters: { ...NO_FILTERS, place: "starred" },
    });
    const picker = head.getByRole("button", { name: "View: Starred" });
    expect(picker.dataset.compact).toBeUndefined();
    fireEvent.focus(head.getByRole("textbox"));
    expect(picker.dataset.compact).toBe("true");
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

  it("makes a topic from the picker's foot, through the caller's dialog", () => {
    const { head, onNewTopic } = renderHead();
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "New topic" }));
    expect(onNewTopic).toHaveBeenCalledOnce();
  });
});
