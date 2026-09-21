// The line over the inbox: the places as marks, the one stood in named and
// the inbox counting its unread, and the topic picker at the line's end.
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
}: {
  filters?: ThreadFilters;
  threads?: Filterable[];
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
      topics={[HOUSE, MONEY]}
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
  it("puts the places on one line, the one stood in named and the inbox counting its unread, with the topic picker at its end", () => {
    const { head, places } = renderHead({
      filters: { ...NO_FILTERS, place: "starred" },
    });
    expect(
      places
        .getAllByRole("button")
        .map((mark) => [mark.getAttribute("aria-label"), mark.textContent]),
    ).toEqual([
      ["Inbox", "1"],
      ["Starred", "Starred"],
      ["Drafts", ""],
      ["All", ""],
    ]);
    expect(head.getByRole("button", { name: "Topic" }).textContent).toBe(
      "Topic",
    );
    expect(head.queryByRole("button", { name: "New" })).toBeNull();
  });

  it("counts the unread among the starred, keeps a thread put away out of the inbox's count, and offers Needs you only while something waits", () => {
    const { places } = renderHead({
      threads: [
        thread({
          archived: true,
          starred: true,
          state: "waiting",
          topics: ["house", "money"],
          unread: 2,
        }),
        thread({ starred: true, topics: ["house"], unread: 1 }),
        thread({ unread: 1 }),
      ],
    });
    // Stood in, so it wears its name beside the count.
    expect(places.getByRole("button", { name: "Inbox" }).textContent).toBe(
      "Inbox2",
    );
    expect(places.getByRole("button", { name: "Starred" }).textContent).toBe(
      "2",
    );
    expect(places.getByRole("button", { name: "All" }).textContent).toBe("");
    expect(places.queryByRole("button", { name: "Needs you" })).toBeNull();
    expect(places.queryByRole("button", { name: /Unread/ })).toBeNull();
  });

  it("stands in the inbox while a topic narrows it, and steps back to it from a place keeping the topic and the search", () => {
    const { head, onFiltersChange, places } = renderHead({
      filters: {
        ...NO_FILTERS,
        place: "starred",
        search: "fence",
        topics: ["house"],
      },
    });
    expect(places.getByRole("button", { name: "Inbox" }).ariaPressed).toBe(
      "false",
    );
    expect(head.getByRole("button", { name: "Topic: House" })).toBeTruthy();
    fireEvent.click(places.getByRole("button", { name: "Inbox" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
      topics: ["house"],
    });
  });

  it("keeps the topic when a place is chosen, with the search apart from both", () => {
    const { onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, search: "fence", topics: ["house"] },
    });
    fireEvent.click(places.getByRole("button", { name: "Starred" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      search: "fence",
      topics: ["house"],
    });
  });

  it("stands in Needs you, which is a mark only while something waits on the user, and in All", () => {
    const { onFiltersChange, places } = renderHead({
      threads: [thread({ state: "waiting" })],
    });
    fireEvent.click(places.getByRole("button", { name: "Needs you" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "needsYou",
    });
    fireEvent.click(places.getByRole("button", { name: "All" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "all",
    });
  });

  // Answering the last waiting thread must not strand the filter: the mark
  // stays while it is the place stood in, pressed, and choosing it again
  // steps out.
  it("keeps the Needs you mark while stood in it after nothing waits", () => {
    const { onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, place: "needsYou" },
      threads: [thread({ state: "idle" })],
    });
    const mark = places.getByRole("button", { name: "Needs you" });
    expect(mark.ariaPressed).toBe("true");
    fireEvent.click(mark);
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("steps out of a place by choosing it again", () => {
    const { onFiltersChange, places } = renderHead({
      filters: { ...NO_FILTERS, place: "starred" },
    });
    expect(places.getByRole("button", { name: "Starred" }).ariaPressed).toBe(
      "true",
    );
    fireEvent.click(places.getByRole("button", { name: "Starred" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it("has no search of its own: that sits under the line", () => {
    renderHead();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("narrows the place stood in to one topic from the picker: choosing moves, choosing again lifts it, and either closes the list", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, place: "starred", topics: ["house"] },
    });
    openPicker(head.getByRole("button", { name: "Topic: House" }));
    const list = within(screen.getByRole("menu"));
    expect(
      list
        .getAllByRole("menuitemcheckbox")
        .map((row) => [row.textContent, row.getAttribute("aria-checked")]),
    ).toEqual([
      ["🏠House", "true"],
      ["💸Money", "false"],
    ]);
    fireEvent.click(list.getByRole("menuitemcheckbox", { name: "Money" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
      topics: ["money"],
    });
    expect(screen.queryByRole("menu")).toBeNull();
    openPicker(head.getByRole("button", { name: "Topic: House" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "House" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "starred",
    });
  });

  it("makes a topic from the picker's foot, through the caller's dialog", () => {
    const { head, onNewTopic } = renderHead();
    openPicker(head.getByRole("button", { name: "Topic" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New topic…" }));
    expect(onNewTopic).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
