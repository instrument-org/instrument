import { type WindowTab } from "@/client/atoms/window";
import { type TabId, type TabsModel } from "@/shared/tabs";

import { closedSideOf, closedSidesOf, closedTabGroupOf } from "./tab-model";

/** A closed tab group as its row shows it: its sides as they stood when it closed, the left first. */
interface ClosedGroup {
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
 * by its newest entry.
 */
export function closedGroupsOf(
  recentlyClosed: TabsModel["recentlyClosed"],
): ClosedGroup[] {
  const seen = new Set<string>();
  return recentlyClosed.flatMap((entry): ClosedGroup[] => {
    const [first] = closedTabGroupOf(entry) ?? [];
    if (!first || closedSideOf(entry) || seen.has(first.group)) {
      return [];
    }
    seen.add(first.group);
    const sides = (closedSidesOf(entry) ?? []).flatMap((side) => {
      const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
      return up ? [{ tabs: side.tabs, up }] : [];
    });
    const [lead, ...rest] = sides;
    return lead ? [{ id: entry.id, sides: [lead, ...rest] }] : [];
  });
}
