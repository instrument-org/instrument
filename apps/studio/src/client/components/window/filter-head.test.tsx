// The line over the inbox: one picker over the views and the projects, and the
// search beside it, one view at a time.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
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

const MONEY: Project = {
  color: "#d4a017",
  created: new Date(2),
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
    firstAsk: "",
    starred: false,
    state: "idle",
    title: "",
    unread: false,
    ...overrides,
  };
}

const CHATS = [
  chat({ holds: { apps: ["gmail"] }, project: "house", unread: true }),
  chat({ project: "house" }),
];

/** The picker is a popover, which Radix opens on click. */
function openPicker(picker: HTMLElement) {
  fireEvent.click(picker);
}

function renderHead({
  chats = CHATS,
  drafts = 0,
  filters = NO_FILTERS,
  projects = [HOUSE, MONEY],
}: {
  chats?: Filterable[];
  drafts?: number;
  filters?: ChatFilters;
  projects?: Project[];
} = {}) {
  const onFiltersChange = vi.fn();
  const onNewProject = vi.fn();
  renderWithProviders(
    <FilterHead
      chats={chats}
      drafts={drafts}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onNewProject={onNewProject}
      onProjectDetails={vi.fn()}
      projects={projects}
    />,
  );
  return {
    head: within(screen.getByRole("group", { name: "Filters" })),
    onFiltersChange,
    onNewProject,
  };
}

/** Each row of the open picker with what stands at its end, in order. */
function pickerRows() {
  return screen
    .getAllByRole("menuitemradio")
    .map((row) => row.parentElement?.textContent);
}

describe("FilterHead", () => {
  it("lists the views, then the projects, each with how many chats it holds", () => {
    const { head } = renderHead({
      chats: [
        chat({ starred: true, project: "house", unread: true }),
        chat({ archived: true, project: "house", unread: true }),
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
      "New project",
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

  it("stands in one view at a time, leaving the project and keeping the search", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, search: "fence", projects: ["house"] },
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

  it("picks a project from the picker, keeping the search", () => {
    const { head, onFiltersChange } = renderHead({
      filters: { ...NO_FILTERS, search: "fence" },
    });
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Money/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      search: "fence",
      projects: ["money"],
    });
  });

  it("makes a project from the picker's foot, through the caller's dialog", () => {
    const { head, onNewProject } = renderHead();
    openPicker(head.getByRole("button", { name: "View: Chats" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "New project" }));
    expect(onNewProject).toHaveBeenCalledOnce();
  });
});
