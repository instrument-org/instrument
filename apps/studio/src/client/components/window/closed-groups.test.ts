import { type WindowTab } from "@/client/atoms/window";
import {
  closeGroupSide,
  closeGroupTab,
  closeTabGroup,
  emptyTabsModel,
} from "@/client/lib/tabs-model";
import { TabIdSchema, type TabsModel } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import { closedGroupsOf, closedText } from "./closed-groups";

const tab = (id: string, group: string, side?: 1): WindowTab => ({
  group,
  href: `/files?path=/${id}`,
  id,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});

const entryId = (id: string) => TabIdSchema.parse(id);

/** The rows' entries, and each row's sides by their tabs' ids with the one up. */
const shown = (model: TabsModel) =>
  closedGroupsOf(model.recentlyClosed).map((group) => ({
    id: group.id,
    sides: group.sides.map((side) => ({
      tabs: side.tabs.map((each) => each.id),
      up: side.up.id,
    })),
  }));

describe("closedGroupsOf", () => {
  it("lists whole groups newest first, each laid out as it closed", () => {
    let model = closeTabGroup(emptyTabsModel(), {
      id: entryId("e1"),
      pathname: "/g/one",
      tabs: [tab("file", "one"), tab("folder", "one"), tab("chat", "one")],
      ups: { active: 1 },
    });
    model = closeTabGroup(model, {
      id: entryId("e2"),
      pathname: "/g/two",
      tabs: [tab("left", "two"), tab("right", "two", 1)],
      ups: { active: 0, beside: 1 },
    });
    expect(shown(model)).toEqual([
      {
        id: "e2",
        sides: [
          { tabs: ["left"], up: "left" },
          { tabs: ["right"], up: "right" },
        ],
      },
      {
        id: "e1",
        sides: [{ tabs: ["file", "folder", "chat"], up: "folder" }],
      },
    ]);
  });

  it("shows a group closed one tab at a time once, as its last tab's close left it", () => {
    let model = closeGroupTab(emptyTabsModel(), {
      id: entryId("t1"),
      index: 2,
      pathname: "/g/one",
      tab: tab("chat", "one"),
    });
    model = closeGroupTab(model, {
      id: entryId("t2"),
      index: 1,
      pathname: "/g/one",
      tab: tab("folder", "one"),
    });
    model = closeTabGroup(model, {
      id: entryId("e1"),
      pathname: "/g/one",
      tabs: [tab("file", "one")],
      ups: { active: 0 },
    });
    expect(shown(model)).toEqual([
      { id: "e1", sides: [{ tabs: ["file"], up: "file" }] },
    ]);
  });

  it("leaves out a side closed on its own and a group already shown", () => {
    let model = closeTabGroup(emptyTabsModel(), {
      id: entryId("old"),
      pathname: "/g/one",
      tabs: [tab("file", "one")],
    });
    model = closeTabGroup(model, {
      id: entryId("new"),
      pathname: "/g/one",
      tabs: [tab("folder", "one")],
    });
    model = closeGroupSide(model, {
      focused: false,
      id: entryId("side"),
      pathname: "/g/two",
      side: 1,
      tabs: [tab("right", "two", 1)],
      up: 0,
    });
    expect(shown(model)).toEqual([
      { id: "new", sides: [{ tabs: ["folder"], up: "folder" }] },
    ]);
  });
});

describe("closedText", () => {
  it("names a tab by its title, a group by its first tab and how many it had, and a side by how many", () => {
    const pages = ["Example Domain", "Wikipedia", "Files"];
    expect([
      closedText({ kind: "group", titles: pages }),
      closedText({ kind: "tab", titles: ["Example Domain"] }),
      closedText({ kind: "side", titles: ["Example Domain", "Wikipedia"] }),
      closedText({ kind: "side", titles: ["Example Domain"] }),
    ]).toEqual([
      { context: "Closed tab group · 3 tabs", title: "Example Domain" },
      { context: "Closed tab", title: "Example Domain" },
      { context: "", title: "Closed 2 tabs" },
      { context: "", title: "Closed Example Domain" },
    ]);
  });
});
