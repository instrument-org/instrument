// The head's one measured claim: the topic picker never covers a place mark,
// however narrow the inbox column is dragged. jsdom has no layout, so this is
// the only project that can see it.
import { SIDEBAR_WIDTH_MIN } from "@/client/atoms/orchestrator";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { FilterHead } from "./filter-head";
import {
  type Filterable,
  NO_FILTERS,
  type ThreadFilters,
  type Topic,
} from "./threads";

const TOPICS: Topic[] = [
  { color: "#0f9d6e", createdAt: 1, emoji: "🏠", id: "house", name: "House" },
  { color: "#d4a017", createdAt: 2, emoji: "💸", id: "money", name: "Money" },
  { color: "#2f6fd0", createdAt: 3, emoji: "🚲", id: "bikes", name: "Bikes" },
];

function thread(overrides: Partial<Filterable> = {}): Filterable {
  return {
    archived: false,
    holds: { apps: [], files: [], sites: [] },
    root: { parts: [] },
    starred: false,
    state: "idle",
    title: "",
    topics: [],
    unread: 0,
    ...overrides,
  };
}

/** Every place at once, each counting what it can: the widest the marks ever are. */
const CROWDED = [
  thread({ starred: true, state: "waiting", unread: 3 }),
  thread({ topics: ["house"], unread: 2 }),
];

/** The head in a box of the width the inbox column would give it. */
async function renderAt(width: number, filters: ThreadFilters = NO_FILTERS) {
  const { container } = await renderInBrowser(
    <div style={{ width: `${width}px` }}>
      <FilterHead
        filters={filters}
        onFiltersChange={vi.fn()}
        onNewTopic={vi.fn()}
        onTopicDetails={vi.fn()}
        threads={CROWDED}
        topics={TOPICS}
      />
    </div>,
  );
  const find = (selector: string) => {
    const found = container.querySelector<HTMLElement>(selector);
    if (!found) {
      throw new Error(`no ${selector}`);
    }
    return found;
  };
  const picker = find('button[aria-label^="Topic"]');
  // The last mark rather than the row around it: a row that shrinks under
  // marks that do not is a row whose box says nothing about where they are.
  const marks = [...find('[aria-label="Places"]').children];
  const last = marks.at(-1);
  if (!(last instanceof HTMLElement)) {
    throw new TypeError("no places");
  }
  return {
    head: find('[aria-label="Filters"]').getBoundingClientRect(),
    picker: picker.getBoundingClientRect(),
    places: last.getBoundingClientRect(),
    // The marks and the word together, which is what each step down drops
    // one of.
    worn: picker.textContent,
  };
}

describe("FilterHead", () => {
  it.each([
    ["the narrowest column", SIDEBAR_WIDTH_MIN],
    ["the width it opens at", 400],
    ["a wide column", 720],
  ])("keeps the picker clear of the places at %s", async (_at, width) => {
    const { head, picker, places } = await renderAt(width);
    expect(picker.left).toBeGreaterThanOrEqual(places.right);
    expect(Math.round(picker.right)).toBeLessThanOrEqual(
      Math.round(head.right),
    );
  });

  it("truncates a chosen topic's pill rather than letting it reach the places", async () => {
    const { picker, places } = await renderAt(SIDEBAR_WIDTH_MIN, {
      ...NO_FILTERS,
      topics: ["house"],
    });
    expect(picker.left).toBeGreaterThanOrEqual(places.right);
  });

  // The places here are as wide as they ever get, so these are the widths
  // the steps fall at for an inbox with something in every place.
  it("steps down to the word, and then to a mark alone, as the room runs out", async () => {
    const wide = await renderAt(720);
    const middling = await renderAt(380);
    const narrow = await renderAt(SIDEBAR_WIDTH_MIN);
    expect([wide.worn, middling.worn, narrow.worn]).toEqual([
      "🏠💸🚲Topic",
      "Topic",
      "🏠",
    ]);
  });

  it("wears a chosen topic's mark alone rather than a name cut to nothing", async () => {
    const narrow = await renderAt(SIDEBAR_WIDTH_MIN, {
      ...NO_FILTERS,
      topics: ["house"],
    });
    expect(narrow.worn).toBe("🏠");
  });
});
