import { type Tab, type TabId, TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import {
  addTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  duplicateTab,
  emptyTabsModel,
  insertTab,
  removeTab,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectOrAddTab,
  selectTab,
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

describe("selectOrAddTab", () => {
  const atChat = (candidate: Tab) => candidate.pathname === "/chats/a";

  it("selects the tab that matches, adding none", () => {
    const start = model(
      [tab({ id: id("a"), pathname: "/chats/a" }), tab({ id: id("b") })],
      id("b"),
    );

    const next = selectOrAddTab(start, {
      id: id("new"),
      matches: atChat,
      pathname: "/chats/a",
    });

    expect(next.selectedId).toBe(id("a"));
    expect(next.tabs).toBe(start.tabs);
  });

  it("adds and selects a tab when none matches", () => {
    const next = selectOrAddTab(model([tab({ id: id("b") })], id("b")), {
      id: id("new"),
      matches: atChat,
      pathname: "/chats/a",
    });

    expect(next.selectedId).toBe(id("new"));
    expect(next.tabs.map((entry) => entry.pathname)).toEqual([
      "/new-tab",
      "/chats/a",
    ]);
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

  it("keeps a tab the order does not name, past the ones it does", () => {
    const start = model([
      tab({ id: id("a") }),
      tab({ id: id("opened-since") }),
      tab({ id: id("b") }),
    ]);
    const next = reorderTabs(start, { ids: [id("b"), id("a")] });
    expect(next.tabs.map((t) => t.id)).toEqual(["b", "a", "opened-since"]);
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

  it.each([
    { closing: "a", expected: ["restored", "b", "c"] },
    { closing: "b", expected: ["a", "restored", "c"] },
    { closing: "c", expected: ["a", "b", "restored"] },
  ])(
    "puts tab $closing back where it was closed from",
    ({ closing, expected }) => {
      const start = model(
        [tab({ id: id("a") }), tab({ id: id("b") }), tab({ id: id("c") })],
        id("a"),
      );
      const closed = closeTab(start, {
        id: id(closing),
        newTab: { id: id("fresh"), pathname: "/new-tab" },
      });
      const reopened = reopenClosed(closed, { id: id("restored") });
      expect(reopened.tabs.map((t) => t.id)).toEqual(expected);
      expect(reopened.selectedId).toBe("restored");
    },
  );

  it("puts a tab at the end of a strip that has grown shorter", () => {
    const start = model(
      [tab({ id: id("a") }), tab({ id: id("b") }), tab({ id: id("c") })],
      id("a"),
    );
    const fresh = { id: id("fresh"), pathname: "/new-tab" };
    const closedC = closeTab(start, { id: id("c"), newTab: fresh });
    const closedB = closeTab(closedC, { id: id("b"), newTab: fresh });
    // c was third; only a is left, so it lands after a.
    const reopened = reopenClosed(closedB, { entry: 1, id: id("restored") });
    expect(reopened.tabs.map((t) => t.id)).toEqual(["a", "restored"]);
    expect(reopened.recentlyClosed.map((t) => t.id)).toEqual(["b"]);
  });

  it("no-ops with empty history", () => {
    const start = model([tab({ id: id("a") })], id("a"));
    expect(reopenClosed(start, { id: id("x") })).toBe(start);
  });
});

describe("closing several", () => {
  const strip = () =>
    model(
      ["a", "b", "c", "d"].map((value) => tab({ id: id(value) })),
      id("a"),
    );
  const reopenAll = (start: TabsModel) => {
    let next = start;
    for (const [index] of start.recentlyClosed.entries()) {
      next = reopenClosed(next, { id: id(`r${index}`) });
    }
    return next.tabs.map((t) => t.id);
  };

  it.each([
    { close: closeOtherTabs, kept: ["c"], reopened: ["r0", "r1", "c", "r2"] },
    {
      close: closeTabsToRight,
      kept: ["a", "b", "c"],
      reopened: ["a", "b", "c", "r0"],
    },
  ])(
    "$close.name keeps $kept, and reopening restores the order",
    ({ close, kept, reopened }) => {
      const closed = close(strip(), { id: id("c") });
      expect(closed.tabs.map((t) => t.id)).toEqual(kept);
      expect(closed.selectedId).toBe("c");
      expect(reopenAll(closed)).toEqual(reopened);
    },
  );

  it("no-ops with nothing to close", () => {
    const start = strip();
    expect(closeTabsToRight(start, { id: id("d") })).toBe(start);
  });
});

describe("duplicateTab", () => {
  it("puts a copy with the same history right of the tab, up", () => {
    const history = { entries: ["/files", "/files?path=a"], index: 1 };
    const start = model(
      [
        tab({ history, id: id("a"), pathname: "/files?path=a" }),
        tab({ id: id("b") }),
      ],
      id("b"),
    );
    const next = duplicateTab(start, { id: id("a"), newId: id("copy") });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "copy", "b"]);
    expect(next.tabs[1]).toMatchObject({ history, pathname: "/files?path=a" });
    expect(next.selectedId).toBe("copy");
  });

  it("puts a copy at a place of its own where one is given", () => {
    const start = model(
      [tab({ id: id("a"), pathname: "/sites/one" })],
      id("a"),
    );
    const next = duplicateTab(start, {
      id: id("a"),
      newId: id("copy"),
      pathname: "/sites/two",
    });
    expect(next.tabs[1]?.pathname).toBe("/sites/two");
    expect(next.tabs[1]?.history).toBeUndefined();
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

describe("a tab moving between windows", () => {
  const tabAt = (name: string) => ({
    id: TabIdSchema.parse(name),
    pathname: `/${name}`,
  });
  const strip = (...names: string[]) => ({
    recentlyClosed: [],
    selectedId: TabIdSchema.parse(names[0]),
    tabs: names.map(tabAt),
  });
  const idsOf = ({ tabs }: { tabs: { id: TabId }[] }) =>
    tabs.map((each) => each.id);
  const newTab = tabAt("fresh");

  it("leaves with nothing to reopen, the one beside it up", () => {
    const after = removeTab(strip("a", "b"), {
      id: TabIdSchema.parse("a"),
      newTab,
    });
    expect(idsOf(after)).toEqual(["b"]);
    expect(after.selectedId).toBe("b");
    expect(after.recentlyClosed).toEqual([]);
  });

  it("leaves a fresh tab where it was the last", () => {
    const after = removeTab(strip("a"), { id: TabIdSchema.parse("a"), newTab });
    expect(after.tabs).toEqual([newTab]);
    expect(after.recentlyClosed).toEqual([]);
  });

  it.each([
    { index: undefined, want: ["a", "b", "x"] },
    { index: 0, want: ["x", "a", "b"] },
    { index: 1, want: ["a", "x", "b"] },
    { index: 9, want: ["a", "b", "x"] },
  ])("lands up at $index", ({ index, want }) => {
    const after = insertTab(strip("a", "b"), {
      ...(index === undefined ? {} : { index }),
      tab: tabAt("x"),
    });
    expect(idsOf(after)).toEqual(want);
    expect(after.selectedId).toBe("x");
  });

  it("does not stand twice if it was there already", () => {
    const after = insertTab(strip("a", "b"), { tab: tabAt("a") });
    expect(idsOf(after)).toEqual(["b", "a"]);
  });
});
