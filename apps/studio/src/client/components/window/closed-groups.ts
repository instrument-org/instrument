import { type WindowTab } from "@/client/atoms/window";
import { type TabId, type TabsModel } from "@/shared/tabs";
import { type ChatId } from "@instrument-org/workspace/client";

import {
  chatOfTab,
  closedSideOf,
  closedSidesOf,
  closedTabGroupOf,
  isFreshTab,
  isHomeTab,
} from "./tab-model";
import { matchScreen, type Screen } from "./window-href";

/** The screens a group of nothing else is not listed for, as each is one press away. */
const NOT_LISTED: ReadonlySet<Screen["kind"]> = new Set(["activity"]);

/** Whether a tab is worth its group's being listed: not a blank new tab, nor a screen that is only the way to something else. */
function isWorthListing(tab: WindowTab) {
  return !(
    isFreshTab(tab) ||
    isHomeTab(tab) ||
    (tab.kind === "screen" && NOT_LISTED.has(matchScreen(tab.href).kind))
  );
}

/** A closed tab group as its row shows it: its sides as they stood when it closed, the left first. */
export interface ClosedGroup {
  /** When it closed, in ms; none for one closed before closes were timed. */
  closedAt: number | undefined;
  /** The closed list's entry that brings it back. */
  id: TabId;
  sides: readonly [ClosedSide, ...ClosedSide[]];
}

interface ClosedSide {
  tabs: readonly WindowTab[];
  up: WindowTab;
}

/**
 * The tab groups this window closed, newest first, read off the closed list
 * Shift+Cmd+T reopens: each entry that holds a whole group (`closeTabGroup`),
 * laid out as the group stood as it closed. A tab or a side closed on its own
 * stands for no group, so a group closed one tab at a time shows once, as the
 * entry its last tab's close made. A group on the list more than once shows
 * by its newest entry. A group with no tab worth listing (`isWorthListing`)
 * is left out, and comes back by Shift+Cmd+T alone.
 */
export function closedGroupsOf(
  recentlyClosed: TabsModel["recentlyClosed"],
): ClosedGroup[] {
  const seen = new Set<string>();
  return recentlyClosed.flatMap((entry): ClosedGroup[] => {
    const tabs = closedTabGroupOf(entry) ?? [];
    const [first] = tabs;
    if (
      !first ||
      closedSideOf(entry) ||
      seen.has(first.group) ||
      !tabs.some(isWorthListing)
    ) {
      return [];
    }
    seen.add(first.group);
    const sides = (closedSidesOf(entry) ?? []).flatMap((side) => {
      const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
      return up ? [{ tabs: side.tabs, up }] : [];
    });
    const [lead, ...rest] = sides;
    return lead
      ? [{ closedAt: entry.closedAt, id: entry.id, sides: [lead, ...rest] }]
      : [];
  });
}

/** The tab group closed last with a tab on a chat, off the window's closed list. */
export function closedGroupOfChat(
  recentlyClosed: TabsModel["recentlyClosed"],
  chat: ChatId,
): ClosedGroup | undefined {
  return closedGroupsOf(recentlyClosed).find((group) =>
    group.sides.some((side) =>
      side.tabs.some((tab) => chatOfTab(tab) === chat),
    ),
  );
}

/**
 * What a closed entry says by name: a tab or a whole tab group by its first
 * tab's title and what closed; one side of a group as "Closed 2 tabs", or
 * "Closed" and the title of a side of one.
 */
export function closedText({
  kind,
  titles,
}: {
  kind: "group" | "side" | "tab";
  titles: readonly string[];
}): { context: string; title: string } {
  const count = titles.length;
  const first = titles[0] ?? "";
  switch (kind) {
    case "group": {
      return {
        context: `Closed tab group · ${count} ${count === 1 ? "tab" : "tabs"}`,
        title: first,
      };
    }
    case "side": {
      return {
        context: "",
        title: count === 1 ? `Closed ${first}` : `Closed ${count} tabs`,
      };
    }
    case "tab": {
      return { context: "Closed tab", title: first };
    }
  }
}
