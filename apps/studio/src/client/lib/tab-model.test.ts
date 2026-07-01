import { type Tab } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import {
  addTab,
  closeTab,
  emptyTabsModel,
  navigate,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectTab,
  setTabMeta,
  setTabPathname,
  type TabsModel,
} from "./tab-model";

function model(tabs: Tab[], selectedId: null | string = null): TabsModel {
  return { recentlyClosed: [], selectedId, tabs };
}

function tab(partial: Partial<Tab> & Pick<Tab, "id">): Tab {
  return { pathname: "/new-tab", pinned: false, ...partial };
}

describe("addTab", () => {
  it("appends and selects by default", () => {
    const next = addTab(emptyTabsModel(), { id: "a", pathname: "/new-tab" });
    expect(next.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(next.selectedId).toBe("a");
  });

  it("respects select: false", () => {
    const start = addTab(emptyTabsModel(), { id: "a", pathname: "/new-tab" });
    const next = addTab(start, { id: "b", pathname: "/tasks", select: false });
    expect(next.selectedId).toBe("a");
    expect(next.tabs).toHaveLength(2);
  });

  it("allows multiple tabs of the same route (no single-tab collapse)", () => {
    const start = model([tab({ id: "a", pathname: "/tasks/123" })], "a");
    const next = addTab(start, { id: "b", pathname: "/tasks/123" });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.selectedId).toBe("b");
  });

  it("allows distinct single-tab routes to coexist", () => {
    const start = model([tab({ id: "a", pathname: "/tasks/123" })], "a");
    const next = addTab(start, { id: "b", pathname: "/tasks/456" });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("closeTab", () => {
  const seed = { id: "fresh", pathname: "/new-tab" };

  it("selects the right neighbor, falling back to left", () => {
    const start = model(
      [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
      "b",
    );
    expect(closeTab(start, { id: "b", newTab: seed }).selectedId).toBe("c");

    const startLast = model([tab({ id: "a" }), tab({ id: "b" })], "b");
    expect(closeTab(startLast, { id: "b", newTab: seed }).selectedId).toBe("a");
  });

  it("keeps selection when closing a non-selected tab", () => {
    const start = model([tab({ id: "a" }), tab({ id: "b" })], "a");
    expect(closeTab(start, { id: "b", newTab: seed }).selectedId).toBe("a");
  });

  it("refuses to close pinned tabs", () => {
    const start = model([tab({ id: "a", pinned: true })], "a");
    expect(closeTab(start, { id: "a", newTab: seed })).toBe(start);
  });

  it("seeds a fresh tab when the last one closes", () => {
    const start = model([tab({ id: "a" })], "a");
    const next = closeTab(start, { id: "a", newTab: seed });
    expect(next.tabs.map((t) => t.id)).toEqual(["fresh"]);
    expect(next.selectedId).toBe("fresh");
  });

  it("records the closed tab for reopen", () => {
    const start = model([tab({ id: "a" }), tab({ id: "b" })], "a");
    const next = closeTab(start, { id: "a", newTab: seed });
    expect(next.recentlyClosed.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("selection", () => {
  it("selectTab ignores unknown ids", () => {
    const start = model([tab({ id: "a" })], "a");
    expect(selectTab(start, { id: "ghost" })).toBe(start);
  });

  it("selectByIndex uses visible order", () => {
    const start = model([tab({ id: "a" }), tab({ id: "b" })], "a");
    expect(selectByIndex(start, { index: 1 }).selectedId).toBe("b");
  });

  it("selectAdjacent wraps and no-ops on a single tab", () => {
    const two = model([tab({ id: "a" }), tab({ id: "b" })], "b");
    expect(selectAdjacent(two, { delta: 1 }).selectedId).toBe("a");
    expect(selectAdjacent(two, { delta: -1 }).selectedId).toBe("a");
    const one = model([tab({ id: "a" })], "a");
    expect(selectAdjacent(one, { delta: 1 })).toBe(one);
  });

  it("excludes tabBarHidden tabs from index/adjacent navigation", () => {
    const start = model(
      [
        tab({ id: "a" }),
        tab({ id: "hidden", tabBarHidden: true }),
        tab({ id: "b" }),
      ],
      "a",
    );
    expect(selectByIndex(start, { index: 1 }).selectedId).toBe("b");
  });
});

describe("reorderTabs", () => {
  it("keeps pinned tabs first, then the requested order", () => {
    const start = model([
      tab({ id: "p", pinned: true }),
      tab({ id: "a" }),
      tab({ id: "b" }),
    ]);
    const next = reorderTabs(start, { ids: ["b", "a"] });
    expect(next.tabs.map((t) => t.id)).toEqual(["p", "b", "a"]);
  });
});

describe("reopenClosed", () => {
  it("restores the most recently closed tab with a new id", () => {
    const start = model([tab({ id: "a" })], "a");
    const closed = closeTab(addTab(start, { id: "b", pathname: "/tasks/9" }), {
      id: "b",
      newTab: { id: "fresh", pathname: "/new-tab" },
    });
    const reopened = reopenClosed(closed, { id: "restored" });
    expect(reopened.tabs.some((t) => t.pathname === "/tasks/9")).toBe(true);
    expect(reopened.recentlyClosed).toHaveLength(0);
  });

  it("no-ops with empty history", () => {
    const start = model([tab({ id: "a" })], "a");
    expect(reopenClosed(start, { id: "x" })).toBe(start);
  });
});

describe("navigate", () => {
  it("updates the selected tab's pathname", () => {
    const start = model([tab({ id: "a", pathname: "/new-tab" })], "a");
    const next = navigate(start, { pathname: "/evals" });
    expect(next.tabs[0]?.pathname).toBe("/evals");
  });

  it("navigates the selected tab even if another tab has that route", () => {
    const start = model(
      [
        tab({ id: "a", pathname: "/tasks/1" }),
        tab({ id: "b", pathname: "/new-tab" }),
      ],
      "b",
    );
    const next = navigate(start, { pathname: "/tasks/1" });
    expect(next.selectedId).toBe("b");
    expect(next.tabs[1]?.pathname).toBe("/tasks/1");
  });
});

describe("setTabPathname", () => {
  it("updates only the given tab's pathname", () => {
    const start = model(
      [tab({ id: "a", pathname: "/tasks/1" }), tab({ id: "b" })],
      "a",
    );
    const next = setTabPathname(start, { id: "b", pathname: "/evals" });
    expect(next.tabs[0]?.pathname).toBe("/tasks/1");
    expect(next.tabs[1]?.pathname).toBe("/evals");
  });
});

describe("setTabMeta", () => {
  it("replaces the resolved meta, clearing a stale icon on navigation", () => {
    // project (has an icon) -> task (no icon, uses its status ring) in one tab
    const start = model(
      [tab({ iconName: "project", id: "a", title: "My project" })],
      "a",
    );
    const next = setTabMeta(start, { id: "a", title: "My task" });
    expect(next.tabs[0]?.title).toBe("My task");
    expect(next.tabs[0]?.iconName).toBeUndefined();
  });
});
