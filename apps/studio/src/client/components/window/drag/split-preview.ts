import { type WindowTab } from "@/client/atoms/window";

import {
  type GroupLayout,
  groupLayoutOf,
  moveTabTo,
  tabsIn,
  type WindowTabs,
} from "../tab-model";
import { heldTabsOf } from "./held-tabs";
import { type Held, type Landing } from "./types";

/**
 * The tabs a whole group brings to a side, in their strip order, left side
 * first, and the one that comes up there: the tab up on the half its row
 * was pressed by, else the tab up on the side with the keyboard.
 */
export function tabsOfHeldGroup(
  held: Extract<Held, { kind: "group" }>,
  state: WindowTabs,
): { front: string | undefined; ids: string[] } {
  const layout = groupLayoutOf(state, held.group);
  return {
    front: layout.sides[held.half ?? layout.focused]?.up,
    ids: layout.sides.flatMap((side) => side.tabs.map((tab) => tab.id)),
  };
}

/**
 * What letting go at a lone side's end would make of the group, worked out
 * by the moves letting go makes (`moveTabTo`), so the side shown sliding in
 * is the side the drop leaves: what is held, as its tabs, at that end, the
 * front one up. A whole group brings every tab it has. Files and a bookmark,
 * which have no tab yet, stand in as the tabs they open as (`heldTabsOf`).
 * The side the group had keeps the keyboard while it is only shown. None
 * where what is held has no tab here, as another window's.
 */
export function splitPreviewOf({
  held,
  landing,
  state,
}: {
  held: Held;
  landing: Extract<Landing, { kind: "side" }>;
  state: WindowTabs;
}): { layout: GroupLayout; side: 0 | 1; standIns: Set<string> } | undefined {
  const { group } = landing;
  if (
    !landing.split ||
    groupLayoutOf(state, group).sides.length !== 1 ||
    tabsIn(state, group).length === 0
  ) {
    return undefined;
  }
  let next = state;
  let ids: string[];
  let front: string | undefined;
  const standIns = new Set<string>();
  if (held.kind === "group") {
    ({ front, ids } = tabsOfHeldGroup(held, state));
  } else if (held.kind === "tab") {
    ids = state.tabs.some((tab) => tab.id === held.id) ? [held.id] : [];
    [front] = ids;
  } else {
    const made: WindowTab[] = heldTabsOf(held, state.tabs).map((tab) => ({
      ...tab,
      group,
    }));
    for (const tab of made) {
      standIns.add(tab.id);
    }
    next = { ...next, tabs: [...next.tabs, ...made] };
    ids = made.map((tab) => tab.id);
    [front] = ids;
  }
  if (ids.length === 0 || front === undefined) {
    return undefined;
  }
  ids.forEach((id, index) => {
    next = moveTabTo(next, {
      group,
      id,
      select: id === front,
      side: landing.side,
      split: index === 0,
    });
  });
  const layout = groupLayoutOf(next, group);
  if (layout.sides.length !== 2) {
    return undefined;
  }
  const side: 0 | 1 = layout.sides[1]?.tabs.some((tab) => tab.id === front)
    ? 1
    : 0;
  return {
    layout: { ...layout, focused: side === 0 ? 1 : 0 },
    side,
    standIns,
  };
}
