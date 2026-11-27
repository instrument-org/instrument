import { type WindowTab } from "@/client/atoms/window";
import { useLayoutEffect, useRef } from "react";

import { type ScreenNames } from "./screen-presentation";
import { chatOfTab, type GroupLayout } from "./tab-model";
import { tabTitle } from "./tab-title";
import { useWindowTabs } from "./window-tabs";

/** A group's sides as its row reads them: each side's tabs and the one in front, the left side first. */
export type RowSides = readonly [RowSide, ...RowSide[]];
type RowSide = { tabs: readonly WindowTab[]; up: WindowTab };

/** A group's layout as its row reads it; none for a group whose tabs are not in yet. */
export function rowSidesOf(layout: GroupLayout): RowSides | undefined {
  const [first, ...rest] = layout.sides.flatMap((side) => {
    const up = side.tabs.find((tab) => tab.id === side.up) ?? side.tabs[0];
    return up ? [{ tabs: side.tabs, up }] : [];
  });
  return first ? [first, ...rest] : undefined;
}

/**
 * The tab a group goes by: its first chat, else the tab held for it
 * (`useGroupLeadUpkeep`), else, with none held or that one since closed, the
 * left side's front tab.
 */
export function leadTabOf(
  sides: RowSides,
  held: string | undefined,
): WindowTab {
  return (
    sides
      .flatMap((side) => side.tabs)
      .find((tab) => chatOfTab(tab) !== undefined) ??
    sides[0].tabs.find((tab) => tab.id === held) ??
    sides[0].up
  );
}

/**
 * What a group is called, by the tab it goes by: the title of its sidebar
 * row, what the command menu lists it by, and what the agent names it by
 * (`ListedGroup.name`). None for a group whose tabs are not in yet.
 */
export function groupTitleOf(
  layout: GroupLayout,
  held: string | undefined,
  names: ScreenNames,
): string | undefined {
  const sides = rowSidesOf(layout);
  return sides && tabTitle(leadTabOf(sides, held), names);
}

/**
 * Holds the tab each group the window lists goes by where it has no chat
 * (`GroupOwn.lead`): the left side's front tab when the group was last left,
 * or when a window first listed it. Kept while the group is up, so picking
 * another tab in it does not rename it.
 */
export function useGroupLeadUpkeep(
  groupUp: string | undefined,
  listed: readonly string[],
) {
  const { groupOwn, layoutOf, setGroupOwn } = useWindowTabs();
  const lastUp = useRef(groupUp);
  // Before paint, so a row never shows the tab it stopped going by.
  useLayoutEffect(() => {
    const left = lastUp.current === groupUp ? undefined : lastUp.current;
    lastUp.current = groupUp;
    for (const group of listed) {
      const held = groupOwn[group]?.lead;
      const lead =
        held === undefined || group === left
          ? rowSidesOf(layoutOf(group))?.[0].up.id
          : held;
      if (lead !== undefined && lead !== held) {
        setGroupOwn(group, { lead });
      }
    }
  });
}
