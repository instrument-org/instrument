import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import { joinTabGroups, splitTabGroups } from "./tab-members";
import { chatSideOf, groupLayoutOf, type WindowTabs } from "./tab-model";
import { applyTabCommand, type TabCommand } from "./tab-ops";

const G = "group_a";
const here = { onScreen: G };
const screen = (id: string, href: string, side?: 1): WindowTab => ({
  group: G,
  href,
  id,
  kind: "screen",
  ...(side ? { side } : {}),
});
const chat = (id: string, side?: 1) => screen(id, `/chats/${id}`, side);
const newTab = (id: string, side?: 1) => screen(id, NEW_TAB_HREF, side);
const page = (id: string, side?: 1): WindowTab => ({
  group: G,
  id,
  kind: "page",
  openedAt: 1,
  url: `https://example.com/${id}`,
  ...(side ? { side } : {}),
});
const tabsOf = (tabs: WindowTab[], active = tabs[0]?.id ?? ""): WindowTabs => ({
  activeByGroup: { [G]: active },
  groups: {},
  tabs,
});
const run = (state: WindowTabs, op: TabCommand["op"], ...args: unknown[]) =>
  applyTabCommand(state, here, { args, op }).state;
const chatSideIn = (state: WindowTabs) => state.groups?.[G]?.chatSide;
const openOther = (state: WindowTabs, { side: _side, ...tab }: WindowTab) =>
  run(state, "openInGroup", tab, { group: G, select: true, side: 1 });

describe("which side of a split is sized as a chat", () => {
  it.each<[string, WindowTab, WindowTab, 0 | 1 | undefined]>([
    ["a chat and a page", chat("a"), page("b", 1), 0],
    ["a page and a chat", page("a"), chat("b", 1), 1],
    ["a chat and a folder", chat("a"), screen("b", "/files?path=%2Fx", 1), 0],
    ["a chat and a New Tab", chat("a"), newTab("b", 1), 0],
    ["a New Tab and a chat", newTab("a"), chat("b", 1), 1],
    ["a page and a New Tab", page("a"), newTab("b", 1), 1],
    ["a New Tab and a page", newTab("a"), page("b", 1), 0],
    ["two chats", chat("a"), chat("b", 1), undefined],
    ["two pages", page("a"), page("b", 1), undefined],
    ["two New Tabs", newTab("a"), newTab("b", 1), undefined],
  ])("for %s", (_, left, right, side) => {
    expect(chatSideOf(groupLayoutOf(tabsOf([left, right]), G))).toBe(side);
  });

  it.each([
    ["the person's click", { chatTab: "a", gesture: "click" }, undefined],
    ["the agent", { chatTab: "a", isShown: true }, "a"],
  ])("is set whoever opens the page: %s", (_, ask, openedBy) => {
    const state = run(tabsOf([chat("a")]), "openPageBesideChat", {
      ask,
      id: "b",
      openedAt: 1,
      ...(openedBy ? { openedBy } : {}),
      url: "https://example.com/",
    });
    expect(chatSideIn(state)).toBe(0);
    expect(state.groups?.[G]?.share).toBeUndefined();
  });

  it("is the right when a page is dropped in on a chat's left", () => {
    const state = run(tabsOf([chat("a"), page("b")]), "moveTabTo", {
      group: G,
      id: "b",
      select: true,
      side: 0,
      split: true,
    });
    expect(chatSideIn(state)).toBe(1);
  });

  it("stays as other tabs come up, and goes as the split closes", () => {
    const made = openOther(tabsOf([chat("a")]), page("b"));
    const two = openOther(made, chat("c"));
    expect(chatSideIn(two)).toBe(0);
    expect(chatSideIn(run(two, "pickTab", "c"))).toBe(0);
    expect(chatSideIn(run(two, "closeSide", G, 1))).toBeUndefined();
  });

  it("is set as an agent's page takes the place of a New Tab beside a chat that was one", () => {
    const state = run(
      tabsOf([chat("a"), newTab("blank", 1)]),
      "openPageBesideChat",
      {
        ask: { chatTab: "a", isShown: true },
        id: "b",
        openedAt: 1,
        url: "https://example.com/",
      },
    );
    expect(chatSideIn(state)).toBe(0);
  });

  it("leaves the person's share through a side closed and reopened", () => {
    const made = openOther(tabsOf([chat("a")]), page("b"));
    const sized = run(made, "withGroupOwn", G, { share: 0.5 });
    const closed = run(sized, "closeSide", G, 1);
    const back = run(closed, "reopenSide", {
      group: G,
      side: 1,
      tabs: [page("b")],
    });
    expect(back.groups?.[G]).toEqual({ chatSide: 0, share: 0.5 });
  });
});

describe("a split's size as it is kept", () => {
  it("comes back as it was written", () => {
    const made = openOther(tabsOf([chat("a")]), page("b"));
    expect(joinTabGroups(splitTabGroups(made)).groups).toEqual(made.groups);
  });

  it.each([
    [[chat("a"), page("b", 1)], { [G]: { chatSide: 0 } }],
    [[chat("a")], {}],
  ])(
    "reads the earlier build's stamp as no share of the person's",
    (tabs, groups) => {
      const kept = { ...tabsOf(tabs), groups: { [G]: { share: 0.38 } } };
      expect(joinTabGroups(splitTabGroups(kept)).groups).toEqual(groups);
    },
  );
});
