import { type ComposeEntry, composeAtom } from "@/client/atoms/window";
import { type Tab, type TabCarryView, type TabId } from "@/shared/tabs";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { moveTabCall } = vi.hoisted(() => ({
  moveTabCall: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { window: { moveTab: { call: moveTabCall } } },
}));

const { appTabsAtom, groupOfHref } = await import("./app-tabs");
const {
  forgetMovedAway,
  hasMovedAway,
  keepOnlyTab,
  letTabGo,
  moveTabOut,
  receiveTab,
} = await import("./move-tab");
const { showTabCarryView, stripIndexAt, tabCarryViewAtom, tabsInView } =
  await import("./tab-carry-view");

const store = getDefaultStore();
const asTab = (id: string) => ({ id, pathname: `/${id}` }) as Tab;
const asId = (id: string) => id as TabId;
const seen = () => {
  const { selectedId, tabs } = store.get(appTabsAtom);
  return { selectedId, tabs: tabs.map((tab) => tab.id) };
};

/** Lays the strip's tabs out 100px wide each, as the layout has them, at a zoom. */
function layOutStrip(ids: string[], zoom = 1) {
  document.body.innerHTML = `<div data-app-tab-strip><div role="tablist">${ids
    .map((id) => `<div data-tab-key="${id}"></div>`)
    .join("")}</div></div>`;
  const list = document.querySelector("[role=tablist]") as HTMLElement;
  Object.defineProperty(list, "offsetWidth", { value: 1000 });
  list.getBoundingClientRect = () =>
    ({ left: 0, width: 1000 * zoom }) as DOMRect;
  document.querySelectorAll("[data-tab-key]").forEach((element, index) => {
    Object.defineProperty(element, "offsetLeft", { value: index * 100 });
    Object.defineProperty(element, "offsetWidth", { value: 100 });
  });
}

beforeEach(() => {
  store.set(appTabsAtom, (current) => ({
    ...current,
    recentlyClosed: [],
    selectedId: asId("a"),
    tabs: [asTab("a"), asTab("b"), asTab("c")],
  }));
  store.set(composeAtom, []);
  layOutStrip(["a", "b", "c"]);
});

describe("what a strip draws of a held tab", () => {
  const tabs = [asTab("a"), asTab("held"), asTab("b")];
  const ids = (shown: readonly { id: TabId }[]) => shown.map(({ id }) => id);

  it("is its own tabs while the tab is on its row", () => {
    expect(ids(tabsInView(tabs, { kind: "row" }, 0))).toEqual([
      "a",
      "held",
      "b",
    ]);
  });

  it("is the tab alone while its window follows the pointer", () => {
    expect(
      ids(tabsInView(tabs, { heldId: asId("held"), kind: "free" }, 0)),
    ).toEqual(["held"]);
  });

  it("is the tab among the other window's while held over its strip", () => {
    const view: TabCarryView = {
      clientX: 0,
      heldId: asId("held"),
      kind: "docked",
      tabs: [asTab("x"), asTab("y")],
    };
    expect(ids(tabsInView(tabs, view, 1))).toEqual(["x", "held", "y"]);
    expect(ids(tabsInView(tabs, view, 2))).toEqual(["x", "y", "held"]);
  });
});

describe("where a held tab stands along a strip", () => {
  it.each([
    ["first, before the next tab's middle", "a", 40, 0],
    ["first, past the next tab's middle", "a", 60, 1],
    ["first, past every tab's middle", "a", 160, 2],
    ["in the middle, before the first tab's middle", "b", 40, 0],
    ["in the middle, past the first tab's middle", "b", 60, 1],
    ["in the middle, past the last tab's middle", "b", 160, 2],
  ])(
    "takes the others as they would stand without it: %s",
    (_case, held, x, at) => {
      expect(stripIndexAt(x, store.get(appTabsAtom).tabs, asId(held))).toBe(at);
    },
  );

  // Asked again with the tab where the answer put it, it answers the same, or
  // the strip would never come to rest.
  it.each([40, 60, 160])("comes to rest with the pointer at %i", (x) => {
    const { tabs } = store.get(appTabsAtom);
    const others = tabs.filter((tab) => tab.id !== "a").map((tab) => tab.id);
    const at = stripIndexAt(x, tabs, asId("a"));
    layOutStrip(others.toSpliced(at, 0, asId("a")));
    expect(stripIndexAt(x, tabs, asId("a"))).toBe(at);
  });

  // A tab back on its row is placed by its left edge, which keeps it in its own
  // slot until it is half a slot off, either way.
  it.each([
    ["in its own slot", "a", 0, 0],
    ["in its own slot", "b", 100, 1],
    ["in its own slot", "c", 200, 2],
    ["just under half a slot right", "b", 149, 1],
    ["just over half a slot right", "b", 151, 2],
    ["just under half a slot left", "b", 51, 1],
    ["just over half a slot left", "b", 49, 0],
  ])("given a tab's left edge: %s, %s at %i", (_case, held, left, at) => {
    expect(stripIndexAt(left, store.get(appTabsAtom).tabs, asId(held))).toBe(
      at,
    );
  });

  it("reads the pointer in on-screen px, at any zoom", () => {
    layOutStrip(["a", "b", "c"], 2);
    expect(stripIndexAt(90, store.get(appTabsAtom).tabs, asId("a"))).toBe(0);
    expect(stripIndexAt(110, store.get(appTabsAtom).tabs, asId("a"))).toBe(1);
  });
});

describe("a window as a tab is let go", () => {
  it("is left with a tab to show when the one it kept was closed while held", () => {
    keepOnlyTab("gone");
    const { selectedId, tabs } = store.get(appTabsAtom);
    expect(tabs).toHaveLength(1);
    expect(selectedId).toBe(tabs[0]?.id);
  });

  it("keeps only the tab when it went off with it, its floats left behind", () => {
    // Only its being there matters here, not what a float has in it.
    store.set(composeAtom, [{ chatId: "chat", kind: "chat" } as ComposeEntry]);
    keepOnlyTab("b");
    expect(seen()).toEqual({ selectedId: "b", tabs: ["b"] });
    expect(store.get(appTabsAtom).recentlyClosed).toEqual([]);
    expect(store.get(composeAtom)).toEqual([]);
  });

  it("leaves another window every site the tab can go back to when it goes there", () => {
    const sites = ["/sites/one", "/sites/two"];
    store.set(appTabsAtom, (current) => ({
      ...current,
      tabs: [
        {
          ...asTab("a"),
          history: { entries: sites, index: 1 },
          pathname: "/sites/two",
        } as Tab,
        asTab("b"),
      ],
    }));
    letTabGo("a");
    const groups = sites.map((href) => groupOfHref(href) ?? "");
    expect(groups.map(hasMovedAway)).toEqual([true, true]);
    groups.forEach(forgetMovedAway);
  });

  it("lets the tab go when another window has it, and brings its neighbor up", () => {
    letTabGo("a");
    expect(seen().tabs).toEqual(["b", "c"]);
    expect(seen().selectedId).not.toBe("a");
  });

  it("takes a tab let go on its strip where it was held, selected", () => {
    receiveTab(asTab("held"), 2);
    expect(seen()).toEqual({
      selectedId: "held",
      tabs: ["a", "b", "held", "c"],
    });
  });
});

describe("moving a tab from a menu", () => {
  beforeEach(() => {
    store.set(appTabsAtom, (current) => ({
      ...current,
      selectedId: asId("a"),
      tabs: [asTab("a"), asTab("b")],
    }));
    // As a drag or a move leaves it, held away from the row.
    showTabCarryView({ heldId: asId("a"), kind: "free" });
  });

  afterEach(() => {
    moveTabCall.mockReset();
  });

  it("asks main as a drag does, with the tab as it stands", async () => {
    moveTabCall.mockResolvedValue({ kind: "none" });
    await moveTabOut(asId("a"), { kind: "new" });
    expect(moveTabCall).toHaveBeenCalledWith({
      isOnlyTab: false,
      moving: {
        neighborPages: [],
        pages: [],
        tab: expect.objectContaining({ id: "a" }) as Tab,
      },
      to: { kind: "new" },
    });
  });

  it.each([
    ["keeps only the tab where the others stay behind", "keepsTab", ["a"]],
    ["lets the tab go where the tab went instead", "losesTab", ["b"]],
    ["changes nothing where nothing moved", "none", ["a", "b"]],
  ])("%s", async (_case, kind, tabs) => {
    moveTabCall.mockResolvedValue({ kind });
    await moveTabOut(asId("a"), { kind: "new" });
    expect(seen().tabs).toEqual(tabs);
    expect(store.get(tabCarryViewAtom)).toEqual({ kind: "row" });
  });

  it("takes on the strip of the window it joined", async () => {
    moveTabCall.mockResolvedValue({
      kind: "takesStrip",
      model: {
        recentlyClosed: [],
        selectedId: "a",
        tabs: [asTab("x"), asTab("a")],
      },
    });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" });
    expect(seen().tabs).toEqual(["x", "a"]);
  });

  it("goes on showing what it shows while its window closes", async () => {
    moveTabCall.mockResolvedValue({ kind: "closes" });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" });
    expect(store.get(tabCarryViewAtom).kind).toBe("free");
  });

  it("stays as it was and back on its row when the call fails", async () => {
    moveTabCall.mockRejectedValue(new Error("the connection went"));
    await moveTabOut(asId("a"), { kind: "new" });
    expect(seen().tabs).toEqual(["a", "b"]);
    expect(store.get(tabCarryViewAtom)).toEqual({ kind: "row" });
  });

  it("leaves a window's only tab where it is, but can take it to another window", async () => {
    store.set(appTabsAtom, (current) => ({
      ...current,
      selectedId: asId("a"),
      tabs: [asTab("a")],
    }));
    await moveTabOut(asId("a"), { kind: "new" });
    expect(moveTabCall).not.toHaveBeenCalled();

    moveTabCall.mockResolvedValue({ kind: "closes" });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" });
    expect(moveTabCall).toHaveBeenCalledWith(
      expect.objectContaining({ isOnlyTab: true }),
    );
  });
});
