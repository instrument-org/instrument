import { type Tab, type TabId, TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import {
  addTab,
  closeTab,
  emptyTabsModel,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectTab,
  setTabMeta,
  setTabPathname,
  type TabsModel,
} from "./tabs-model";

const id = (value: string): TabId => TabIdSchema.parse(value);

function model(tabs: Tab[], selectedId: null | TabId = null): TabsModel {
  return { recentlyClosed: [], selectedId, tabs };
}

function tab(partial: Partial<Tab> & Pick<Tab, "id">): Tab {
  return { pathname: "/new-tab", ...partial };
}

describe("addTab", () => {
  it("appends and selects by default", () => {
    const next = addTab(emptyTabsModel(), {
      id: id("a"),
      pathname: "/new-tab",
    });
    expect(next.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(next.selectedId).toBe("a");
  });

  it("respects select: false", () => {
    const start = addTab(emptyTabsModel(), {
      id: id("a"),
      pathname: "/new-tab",
    });
    const next = addTab(start, {
      id: id("b"),
      pathname: "/tasks",
      select: false,
    });
    expect(next.selectedId).toBe("a");
    expect(next.tabs).toHaveLength(2);
  });

  it("allows multiple tabs of the same route (no single-tab collapse)", () => {
    const start = model(
      [tab({ id: id("a"), pathname: "/tasks/123" })],
      id("a"),
    );
    const next = addTab(start, { id: id("b"), pathname: "/tasks/123" });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.selectedId).toBe("b");
  });

  it("allows distinct single-tab routes to coexist", () => {
    const start = model(
      [tab({ id: id("a"), pathname: "/tasks/123" })],
      id("a"),
    );
    const next = addTab(start, { id: id("b"), pathname: "/tasks/456" });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("closeTab", () => {
  const seed = { id: id("fresh"), pathname: "/new-tab" };

  it("selects the right neighbor, falling back to left", () => {
    const start = model(
      [tab({ id: id("a") }), tab({ id: id("b") }), tab({ id: id("c") })],
      id("b"),
    );
    expect(closeTab(start, { id: id("b"), newTab: seed }).selectedId).toBe("c");

    const startLast = model(
      [tab({ id: id("a") }), tab({ id: id("b") })],
      id("b"),
    );
    expect(closeTab(startLast, { id: id("b"), newTab: seed }).selectedId).toBe(
      "a",
    );
  });

  it("keeps selection when closing a non-selected tab", () => {
    const start = model([tab({ id: id("a") }), tab({ id: id("b") })], id("a"));
    expect(closeTab(start, { id: id("b"), newTab: seed }).selectedId).toBe("a");
  });

  it("seeds a fresh tab when the last one closes", () => {
    const start = model([tab({ id: id("a") })], id("a"));
    const next = closeTab(start, { id: id("a"), newTab: seed });
    expect(next.tabs.map((t) => t.id)).toEqual(["fresh"]);
    expect(next.selectedId).toBe("fresh");
  });

  it("records the closed tab for reopen", () => {
    const start = model([tab({ id: id("a") }), tab({ id: id("b") })], id("a"));
    const next = closeTab(start, { id: id("a"), newTab: seed });
    expect(next.recentlyClosed.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("selection", () => {
  it("selectTab ignores unknown ids", () => {
    const start = model([tab({ id: id("a") })], id("a"));
    expect(selectTab(start, { id: id("ghost") })).toBe(start);
  });

  it("selectByIndex uses tab order", () => {
    const start = model([tab({ id: id("a") }), tab({ id: id("b") })], id("a"));
    expect(selectByIndex(start, { index: 1 }).selectedId).toBe("b");
  });

  it("selectAdjacent wraps and no-ops on a single tab", () => {
    const two = model([tab({ id: id("a") }), tab({ id: id("b") })], id("b"));
    expect(selectAdjacent(two, { delta: 1 }).selectedId).toBe("a");
    expect(selectAdjacent(two, { delta: -1 }).selectedId).toBe("a");
    const one = model([tab({ id: id("a") })], id("a"));
    expect(selectAdjacent(one, { delta: 1 })).toBe(one);
  });
});

describe("reorderTabs", () => {
  it("applies the requested order", () => {
    const start = model([
      tab({ id: id("a") }),
      tab({ id: id("b") }),
      tab({ id: id("c") }),
    ]);
    const next = reorderTabs(start, { ids: [id("c"), id("a"), id("b")] });
    expect(next.tabs.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("reopenClosed", () => {
  it("restores the most recently closed tab with a new id", () => {
    const start = model([tab({ id: id("a") })], id("a"));
    const closed = closeTab(
      addTab(start, { id: id("b"), pathname: "/tasks/9" }),
      {
        id: id("b"),
        newTab: { id: id("fresh"), pathname: "/new-tab" },
      },
    );
    const reopened = reopenClosed(closed, { id: id("restored") });
    expect(reopened.tabs.some((t) => t.pathname === "/tasks/9")).toBe(true);
    expect(reopened.recentlyClosed).toHaveLength(0);
  });

  it("no-ops with empty history", () => {
    const start = model([tab({ id: id("a") })], id("a"));
    expect(reopenClosed(start, { id: id("x") })).toBe(start);
  });
});

describe("setTabPathname", () => {
  it("updates only the given tab's pathname", () => {
    const start = model(
      [tab({ id: id("a"), pathname: "/tasks/1" }), tab({ id: id("b") })],
      id("a"),
    );
    const next = setTabPathname(start, { id: id("b"), pathname: "/evals" });
    expect(next.tabs[0]?.pathname).toBe("/tasks/1");
    expect(next.tabs[1]?.pathname).toBe("/evals");
  });
});

describe("setTabMeta", () => {
  it("replaces the resolved meta, clearing a stale icon on navigation", () => {
    // project (has an icon) -> task (no icon, uses its status ring) in one tab
    const start = model(
      [tab({ iconName: "project", id: id("a"), title: "My project" })],
      id("a"),
    );
    const next = setTabMeta(start, { id: id("a"), title: "My task" });
    expect(next.tabs[0]?.title).toBe("My task");
    expect(next.tabs[0]?.iconName).toBeUndefined();
  });
});
