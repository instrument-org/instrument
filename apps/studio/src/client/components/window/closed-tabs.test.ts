import { type WindowTab } from "@/client/atoms/window";
import { emptyTabsModel } from "@/client/lib/tabs-model";
import { TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import { reopeningOf, withTabClosed } from "./closed-tabs";
import {
  closeTab,
  groupLayoutOf,
  reopenSide,
  reopenTab,
  type WindowTabs,
} from "./tab-model";

const G = "group";
const page = (id: string, side?: 1): WindowTab => ({
  group: G,
  id,
  kind: "page",
  openedAt: 0,
  url: `https://${id}.test/`,
  ...(side === undefined ? {} : { side }),
});

/** Each side's tabs, the one up starred. */
const shape = (state: WindowTabs) =>
  groupLayoutOf(state, G).sides.map((side) =>
    side.tabs
      .map((tab) => (tab.id === side.up ? `*${tab.id}` : tab.id))
      .join(" "),
  );

function closeThenReopen(state: WindowTabs, id: string) {
  const tab = state.tabs.find((each) => each.id === id);
  if (!tab) {
    throw new Error("no tab");
  }
  const closed = withTabClosed(emptyTabsModel(), groupLayoutOf(state, G), tab, {
    id: TabIdSchema.parse("closed"),
    pathname: "/",
  });
  const without = closeTab(state, id);
  const entry = closed.recentlyClosed[0];
  const reopening =
    entry &&
    reopeningOf(entry, {
      again: (each) => ({ ...each, id: `${each.id}2` }),
      isOpen: () => true,
    });
  return reopening?.kind === "side"
    ? reopenSide(without, reopening.placing)
    : reopening?.kind === "tab"
      ? reopenTab(without, reopening.placing)
      : without;
}

describe("a tab closed and reopened", () => {
  it("comes back at its place on the right side, whatever is on the left", () => {
    const state: WindowTabs = {
      activeByGroup: { [G]: "banana" },
      besideByGroup: { [G]: "apple" },
      tabs: [page("apple"), page("banana", 1), page("cherry", 1)],
    };
    expect(shape(closeThenReopen(state, "banana"))).toEqual([
      "*apple",
      "*banana2 cherry",
    ]);
  });

  it.each([
    ["apple", ["*apple2", "*banana"]],
    ["banana", ["*apple", "*banana2"]],
  ])("brings back the side it was alone on (%s)", (id, sides) => {
    const state: WindowTabs = {
      activeByGroup: { [G]: "apple" },
      besideByGroup: { [G]: "banana" },
      tabs: [page("apple"), page("banana", 1)],
    };
    expect(shape(closeThenReopen(state, id))).toEqual(sides);
  });
});
