import { type TabId } from "@/shared/tabs";

import { type ClosedGroup } from "./closed-groups";
import { groupLayoutOf, isHomeTab, tabsIn, type WindowTabs } from "./tab-model";

/** How many tab groups a new tab lists. */
const MOST_LISTED = 6;

/**
 * A tab group as a new tab lists it: its sides as its row draws them, when
 * it was last up (an open one) or closed, and what picking it brings up.
 */
export interface RecentGroup {
  at: number;
  key: string;
  pick: { group: string; kind: "open" } | { id: TabId; kind: "closed" };
  sides: ClosedGroup["sides"];
}

/**
 * The tab groups a window had most recently, newest first: the ones it has
 * open, by when each last came up (`shownAt`), among the ones it closed, by
 * when each closed. The group asking (`home`) is left out, as is an open one
 * of only new tabs, which has nothing to go back to. An open group never
 * stamped, or a close never timed, goes last.
 */
export function recentGroupsOf({
  closed,
  home,
  listed,
  state,
}: {
  closed: readonly ClosedGroup[];
  home: string | undefined;
  listed: readonly string[];
  state: WindowTabs;
}): RecentGroup[] {
  const open = listed.flatMap((group): RecentGroup[] => {
    if (group === home || tabsIn(state, group).every(isHomeTab)) {
      return [];
    }
    const sides = groupLayoutOf(state, group).sides.flatMap((side) => {
      const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
      return up ? [{ tabs: side.tabs, up }] : [];
    });
    const [lead, ...rest] = sides;
    return lead
      ? [
          {
            at: state.groups?.[group]?.shownAt ?? 0,
            key: group,
            pick: { group, kind: "open" },
            sides: [lead, ...rest],
          },
        ]
      : [];
  });
  const back = closed.map(
    (group): RecentGroup => ({
      at: group.closedAt ?? 0,
      key: group.id,
      pick: { id: group.id, kind: "closed" },
      sides: group.sides,
    }),
  );
  return [...open, ...back].sort((a, b) => b.at - a.at).slice(0, MOST_LISTED);
}
