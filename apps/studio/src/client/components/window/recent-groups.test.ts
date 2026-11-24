import { type WindowTab } from "@/client/atoms/window";
import { closeTabGroup, emptyTabsModel } from "@/client/lib/tabs-model";
import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closedGroupOfChat, closedGroupsOf } from "./closed-groups";
import { recentGroupsOf } from "./recent-groups";
import { type WindowTabs } from "./tab-model";
import { chatHref } from "./window-href";

const CHAT = ChatIdSchema.parse("2026-11-14-trip-plan");

const file = (id: string, group: string, side?: 1): WindowTab => ({
  group,
  href: `/files?path=/${id}`,
  id,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});

const newTab = (id: string, group: string): WindowTab => ({
  group,
  href: "/chats",
  id,
  kind: "screen",
});

/** A window's closed list after closing groups one by one, each at its own time. */
function closedAt(groups: [id: string, at: number, tabs: WindowTab[]][]) {
  let model = emptyTabsModel();
  for (const [id, at, tabs] of groups) {
    vi.setSystemTime(at);
    model = closeTabGroup(model, {
      id: TabIdSchema.parse(id),
      pathname: `/g/${id}`,
      tabs,
    });
  }
  return model.recentlyClosed;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recentGroupsOf", () => {
  it("orders open groups among closed ones by when each was last up", () => {
    vi.useFakeTimers();
    const state: WindowTabs = {
      activeByGroup: {},
      groups: { early: { shownAt: 100 }, late: { shownAt: 400 } },
      tabs: [
        newTab("home", "home"),
        file("a", "early"),
        file("b", "late"),
        file("c", "late", 1),
      ],
    };
    const recent = recentGroupsOf({
      closed: closedGroupsOf(
        closedAt([
          ["old", 50, [file("d", "old")]],
          ["mid", 300, [file("e", "mid")]],
        ]),
      ),
      home: "home",
      listed: ["home", "early", "late"],
      state,
    });
    expect(
      recent.map(({ at, pick, sides }) => ({
        at,
        pick: pick.kind === "open" ? pick.group : pick.id,
        sides: sides.map((side) => side.tabs.map((tab) => tab.id)),
      })),
    ).toEqual([
      { at: 400, pick: "late", sides: [["b"], ["c"]] },
      { at: 300, pick: "mid", sides: [["e"]] },
      { at: 100, pick: "early", sides: [["a"]] },
      { at: 50, pick: "old", sides: [["d"]] },
    ]);
  });

  it("leaves out the group asking and any open group of only new tabs", () => {
    const state: WindowTabs = {
      activeByGroup: {},
      tabs: [
        newTab("home", "home"),
        newTab("blank", "other"),
        file("a", "files"),
      ],
    };
    expect(
      recentGroupsOf({
        closed: [],
        home: "home",
        listed: ["home", "other", "files"],
        state,
      }).map((group) => group.key),
    ).toEqual(["files"]);
  });

  it("lists six at most, the newest", () => {
    vi.useFakeTimers();
    const closed = closedGroupsOf(
      closedAt(
        Array.from({ length: 8 }, (_, index): [string, number, WindowTab[]] => [
          `g${index}`,
          index + 1,
          [file(`t${index}`, `g${index}`)],
        ]),
      ),
    );
    expect(
      recentGroupsOf({
        closed,
        home: undefined,
        listed: [],
        state: { activeByGroup: {}, tabs: [] },
      }).map((group) => group.key),
    ).toEqual(["g7", "g6", "g5", "g4", "g3", "g2"]);
  });
});

describe("closedGroupOfChat", () => {
  it("finds the group closed last with a tab on the chat", () => {
    vi.useFakeTimers();
    const chat = (id: string, group: string): WindowTab => ({
      group,
      href: chatHref(CHAT),
      id,
      kind: "screen",
    });
    const closed = closedAt([
      ["first", 1, [chat("c1", "first"), file("a", "first", 1)]],
      ["files", 2, [file("b", "files")]],
      ["second", 3, [chat("c2", "second")]],
    ]);
    expect(closedGroupOfChat(closed, CHAT)?.id).toBe("second");
    expect(
      closedGroupOfChat(closed, ChatIdSchema.parse("2026-11-15-other")),
    ).toBeUndefined();
  });
});
