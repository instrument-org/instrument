// The lines over the inbox: the search with its marks as tokens, the view
// button, and the places as tabs; inside a project, the way back out.
import { chatSearchAskedAtom } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type ChatFilters,
  type Filterable,
  NO_FILTERS,
  type Project,
} from "./chats";
import { FilterHead } from "./filter-head";

const HOUSE: Project = {
  color: "#0f9d6e",
  created: new Date(1),
  emoji: "🏠",
  id: "house",
  name: "House",
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
    firstAsk: "",
    starred: false,
    status: "idle",
    title: "",
    unread: false,
    ...overrides,
  };
}

const CHATS = [
  chat({ holds: { apps: ["gmail"] }, project: "house", unread: true }),
  chat({ project: "house" }),
];

function renderHead({
  chats = CHATS,
  filters = NO_FILTERS,
  project,
}: {
  chats?: Filterable[];
  filters?: ChatFilters;
  project?: Project;
} = {}) {
  const onFiltersChange = vi.fn();
  const onLeaveProject = vi.fn();
  const { store } = renderWithProviders(
    <FilterHead
      chats={chats}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onLeaveProject={onLeaveProject}
      project={project}
    />,
  );
  return {
    head: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onLeaveProject,
    store,
  };
}

describe("FilterHead", () => {
  it("shows the places a chat can be as tabs, the one the column is in chosen", () => {
    const { head } = renderHead({
      filters: { ...NO_FILTERS, place: "archived" },
    });
    expect(
      head
        .getAllByRole("tab")
        .map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]),
    ).toEqual([
      ["Inbox", "false"],
      ["Drafts", "false"],
      ["Archived", "true"],
    ]);
    expect(head.getByRole("combobox").getAttribute("placeholder")).toBe(
      "Search Archived",
    );
  });

  it("moves to a place, leaving a project and keeping the search", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, search: "fence" },
    });
    fireEvent.click(head.getByRole("tab", { name: "Archived" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      place: "archived",
      search: "fence",
    });
  });

  it("offers the marks the view has any of on clicking into the search", () => {
    const { head, onFiltersChange } = renderHead({
      chats: [chat({ unread: true }), chat({ archived: true, starred: true })],
    });
    fireEvent.focus(head.getByRole("combobox"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Unread"]);
    fireEvent.click(screen.getByRole("option", { name: "Unread" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      tags: ["unread"],
    });
  });

  it("offers no marks in Drafts", () => {
    const { head } = renderHead({
      chats: [chat({ unread: true, starred: true })],
      filters: { ...NO_FILTERS, place: "drafts" },
    });
    fireEvent.focus(head.getByRole("combobox"));
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("takes the last token away with Backspace at the field's start", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, tags: ["unread", "starred"] },
    });
    expect(head.getByRole("button", { name: "Remove Starred" })).toBeDefined();
    fireEvent.keyDown(head.getByRole("combobox"), { key: "Backspace" });
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      tags: ["unread"],
    });
  });

  it("inside a project, steps back out to the inbox, with no tabs", () => {
    const { head, onLeaveProject } = renderHead({
      filters: { ...NO_FILTERS, projects: ["house"] },
      project: HOUSE,
    });
    expect(head.queryAllByRole("tab")).toEqual([]);
    fireEvent.click(head.getByRole("button", { name: "Inbox" }));
    expect(onLeaveProject).toHaveBeenCalledOnce();
  });

  it("unfolds the search and gives it the keyboard when Search Chats is asked for", async () => {
    const { head, store } = renderHead({
      filters: { ...NO_FILTERS, projects: ["house"] },
      project: HOUSE,
    });
    expect(head.queryByRole("combobox")).toBeNull();
    act(() => {
      store.set(chatSearchAskedAtom, true);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(head.getByRole("combobox"));
    });
    expect(store.get(chatSearchAskedAtom)).toBe(false);
  });
});
