// The column's two forms are chosen by the pane's own width, which only a
// layout engine can measure: at width the column beside the list, narrow the
// head over it, never both.
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { FilterColumn, FilterHead } from "./filter-column";
import { type Filterable, NO_FILTERS, type Topic } from "./threads";

const HOUSE: Topic = {
  color: "#0f9d6e",
  createdAt: 1,
  emoji: "🏠",
  id: "house",
  name: "House",
};

const THREAD: Filterable = {
  archived: false,
  holds: { apps: ["gmail"], files: [], sites: ["amazon.com"] },
  root: { parts: [] },
  starred: false,
  state: "idle",
  title: "",
  topics: ["house"],
  unread: 1,
};

/** Whether the browser laid the element out at all: `display: none` has no boxes. */
function isLaidOut(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

async function renderPane(width: number) {
  const props = {
    appsBySlug: new Map([
      ["gmail", { name: "Gmail", site: "https://mail.google.com" }],
    ]),
    filters: { ...NO_FILTERS, topics: ["house"] },
    onFiltersChange: vi.fn(),
    onNew: vi.fn(),
    onNewTopic: vi.fn(),
    onTopicDetails: vi.fn(),
    threads: [THREAD],
    topics: [HOUSE],
  };
  const rendered = await renderInBrowser(
    // The pane, as far as the column can tell: the box it sizes itself by,
    // laid out the way the pane lays them: the column beside the list, the
    // head at the list's top.
    <div className="@container/chat flex h-96" style={{ width: `${width}px` }}>
      <FilterColumn {...props} />
      <div className="flex flex-1 flex-col">
        <FilterHead {...props} />
      </div>
    </div>,
  );
  const aside = rendered.container.querySelector("aside");
  const head = rendered.container.querySelector<HTMLElement>(
    'div[role="group"][aria-label="Filters"]',
  );
  if (!aside || !head) {
    throw new Error("no column");
  }
  return { aside, head };
}

describe("FilterColumn and FilterHead", () => {
  it("is the column beside the list when the pane has room, and no head", async () => {
    const { aside, head } = await renderPane(420);
    expect(aside.getBoundingClientRect().width).toBe(160);
    expect(isLaidOut(aside)).toBe(true);
    expect(isLaidOut(head)).toBe(false);
    expect(
      [...aside.querySelectorAll("section, [role=toolbar]")].map((section) =>
        section.getAttribute("aria-label"),
      ),
    ).toEqual(["Topics", "Places", "Apps"]);
  });

  it("gives way to the head over the list when the pane is narrow", async () => {
    const { aside, head } = await renderPane(300);
    expect(isLaidOut(aside)).toBe(false);
    expect(isLaidOut(head)).toBe(true);
    expect(
      [...head.querySelectorAll("button")].map((mark) =>
        mark.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Inbox",
      "Starred",
      "Drafts",
      "All",
      "New",
      "House",
    ]);
    expect(
      head.querySelector('[aria-label="House"]')?.getAttribute("data-chosen"),
    ).toBe("true");
  });
});
