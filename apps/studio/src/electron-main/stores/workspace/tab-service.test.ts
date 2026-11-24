import {
  joinTabGroups,
  splitTabGroups,
} from "@/client/components/window/tab-members";
import { type WindowTabs } from "@/client/components/window/tab-model";
import {
  type TabsAsk,
  type TabsChanged,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { describe, expect, it } from "vitest";

import { changesOfAsk, tabMembersIn } from "./tab-service";

const GROUP = "group:a";
const OTHER = "group:b";
const PREFIX = `${WINDOW_TABS_KEY}/`;

const start: WindowTabs = {
  activeByGroup: { [GROUP]: "t1", [OTHER]: "o1" },
  groups: {},
  tabs: [
    { group: GROUP, href: "/files?path=%2Fhome", id: "t1", kind: "screen" },
    { group: OTHER, href: "/settings", id: "o1", kind: "screen" },
  ],
};

/** The kept members as the main process holds them, and each ask applied to them in the order it arrives. */
function owner(tabs: WindowTabs) {
  const members = new Map<string, unknown>(splitTabGroups(tabs));
  return {
    ask: (ask: TabsAsk): TabsChanged["changes"] => {
      const changes = changesOfAsk(members, ask);
      for (const [, key, value] of changes) {
        const member = key.slice(PREFIX.length);
        if (value === undefined) {
          members.delete(member);
        } else {
          members.set(member, value);
        }
      }
      return changes;
    },
    tabs: () => joinTabGroups(new Map(members)),
  };
}

const openScreen = (id: string, href: string, window: string): TabsAsk => ({
  command: { args: [{ href, id, select: true }], op: "openScreen" },
  id: `${window}:${id}`,
  onScreen: GROUP,
});

describe("the one owner of every tab", () => {
  it("keeps both tabs when two windows each open one in a group before hearing of the other", () => {
    const main = owner(start);
    // Each window asked from the tabs as it had them, with one tab in the group.
    main.ask(openScreen("from-first", "/settings", "first"));
    main.ask(openScreen("from-second", "/activity", "second"));

    expect(
      main
        .tabs()
        .tabs.filter((tab) => tab.group === GROUP)
        .map((tab) => tab.id),
    ).toEqual(["t1", "from-first", "from-second"]);
    expect(main.tabs().activeByGroup[GROUP]).toBe("from-second");
  });

  it("tells only the members an ask changed", () => {
    const main = owner(start);
    const changes = main.ask(openScreen("t2", "/settings", "first"));

    expect(changes.map(([file, key]) => [file, key])).toEqual([
      ["groups", `${PREFIX}${GROUP}`],
    ]);
  });

  it("tells both groups of a tab moved from one to the other, at once", () => {
    const main = owner({
      ...start,
      tabs: [
        ...start.tabs,
        { group: GROUP, href: "/activity", id: "t2", kind: "screen" },
      ],
    });
    const changes = main.ask({
      command: { args: ["t2", OTHER], op: "moveToGroup" },
      id: "first:1",
    });

    expect(changes.map(([, key]) => key).toSorted()).toEqual([
      `${PREFIX}${GROUP}`,
      `${PREFIX}${OTHER}`,
    ]);
    expect(main.tabs().tabs.find((tab) => tab.id === "t2")?.group).toBe(OTHER);
  });

  it("changes nothing for an ask a window made of a tab another window closed first", () => {
    const main = owner(start);
    main.ask({ command: { args: ["t1", {}], op: "closeTab" }, id: "first:1" });
    const late = main.ask({
      command: { args: ["t1", { title: "Home" }], op: "patchPage" },
      id: "second:1",
    });

    expect(late).toEqual([]);
  });

  it("changes nothing for a name that is no change to the tabs", () => {
    const main = owner(start);

    expect(
      main.ask({ command: { args: [], op: "constructor" }, id: "first:1" }),
    ).toEqual([]);
  });

  it("keeps a page drawn inside a window's surface in that window's own file", () => {
    const main = owner(start);
    const changes = main.ask({
      command: {
        args: [[{ group: "page:t1", id: "p1", openedAt: 1 }]],
        op: "addPages",
      },
      id: "first:1",
    });

    expect(changes.map(([file, key]) => [file, key])).toEqual([
      ["window", `${PREFIX}page:t1`],
    ]);
  });

  it("writes a group back in the shape it is kept in, with what it keeps of its own", () => {
    /** A group of two sides as it is kept, the keyboard on the right. */
    const member = {
      focused: 1,
      pinned: true,
      project: "travel",
      share: 0.4,
      sides: [
        {
          tabs: [
            { id: "tab_1", kind: "page", openedAt: 1 },
            { id: "tab_2", kind: "page", openedAt: 2 },
          ],
          up: "tab_2",
        },
        {
          tabs: [{ href: "/chats", id: "tab_3", kind: "screen" }],
          up: "tab_3",
        },
      ],
    };
    const changes = changesOfAsk(new Map([[GROUP, member]]), {
      command: { args: [GROUP, { share: 0.5 }], op: "withGroupOwn" },
      id: "first:1",
    });

    expect(changes).toEqual([
      ["groups", `${PREFIX}${GROUP}`, { ...member, share: 0.5 }],
    ]);
  });

  it("reads a file's tab groups by member, and only the ones that file keeps", () => {
    const keys = {
      "other.v1": 1,
      [`${PREFIX}${GROUP}`]: "a",
      [`${PREFIX}page:t1`]: "hosted",
    };

    expect(tabMembersIn("groups", keys)).toEqual([[GROUP, "a"]]);
    expect(tabMembersIn("window", keys)).toEqual([["page:t1", "hosted"]]);
  });
});
