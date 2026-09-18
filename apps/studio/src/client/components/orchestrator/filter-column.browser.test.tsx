// The column's two forms are chosen by the pane's own width, which only a
// layout engine can measure: at width the rows, narrow the strip of marks,
// both in the same place.
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { FilterColumn } from "./filter-column";
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
  const rendered = await renderInBrowser(
    // The pane, as far as the column can tell: the box it sizes itself by.
    <div className="@container/chat flex h-96" style={{ width: `${width}px` }}>
      <FilterColumn
        appsBySlug={
          new Map([
            ["gmail", { name: "Gmail", site: "https://mail.google.com" }],
          ])
        }
        draftCount={0}
        filters={{ ...NO_FILTERS, topics: ["house"] }}
        onFiltersChange={vi.fn()}
        onNew={vi.fn()}
        onNewTopic={vi.fn()}
        onTopicDetails={vi.fn()}
        threads={[THREAD]}
        topics={[HOUSE]}
      />
      <div className="flex-1" />
    </div>,
  );
  const aside = rendered.container.querySelector("aside");
  const column = rendered.container.querySelector<HTMLElement>(
    '[role="group"][aria-label="Filters"]',
  );
  const strip = rendered.container.querySelector<HTMLElement>(
    '[role="toolbar"][aria-label="Filter marks"]',
  );
  if (!aside || !column || !strip) {
    throw new Error("no column");
  }
  return { aside, column, strip };
}

describe("FilterColumn", () => {
  it("is the full column of rows when the pane has room", async () => {
    const { aside, column, strip } = await renderPane(520);
    expect(aside.getBoundingClientRect().width).toBe(160);
    expect(isLaidOut(column)).toBe(true);
    expect(isLaidOut(strip)).toBe(false);
    expect(
      [...column.querySelectorAll("section")].map((section) =>
        section.getAttribute("aria-label"),
      ),
    ).toEqual(["Places", "Topics", "Apps"]);
  });

  it("shrinks in place to a strip of marks when the pane is narrow", async () => {
    const { aside, column, strip } = await renderPane(320);
    expect(aside.getBoundingClientRect().width).toBe(36);
    expect(aside.getBoundingClientRect().left).toBe(
      aside.parentElement?.getBoundingClientRect().left,
    );
    expect(isLaidOut(column)).toBe(false);
    expect(isLaidOut(strip)).toBe(true);
    expect(
      [...strip.querySelectorAll("button")].map((mark) =>
        mark.getAttribute("aria-label"),
      ),
    ).toEqual([
      "New",
      "Inbox",
      "Unread",
      "Starred",
      "Drafts",
      "All",
      "House",
      "Gmail",
    ]);
    expect(
      strip.querySelector('[aria-label="House"]')?.getAttribute("data-chosen"),
    ).toBe("true");
  });
});
