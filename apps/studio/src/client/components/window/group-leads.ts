import { type WindowTab } from "@/client/atoms/window";
import { atom, useAtom } from "jotai";
import { useLayoutEffect, useRef } from "react";

import { chatOfTab, type GroupLayout } from "./tab-model";
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
 * The tab each of this window's groups goes by where it holds no chat, by
 * the group: the left side's front tab when the group was last left, or when
 * the window first listed it. Kept while the group is up, so picking another
 * tab in it does not rename it (`useGroupLeadUpkeep`).
 */
export const groupLeadsAtom = atom<ReadonlyMap<string, string>>(new Map());

/**
 * The tab a group's row goes by: its first chat, else the tab held for it
 * (`groupLeadsAtom`), else, with none held or that one since closed, the left
 * side's front tab.
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

/** Keeps the tab each group the window lists goes by, as groups come and go and as one goes out of sight. */
export function useGroupLeadUpkeep(
  groupUp: string | undefined,
  listed: readonly string[],
) {
  const { layoutOf } = useWindowTabs();
  const [leads, setLeads] = useAtom(groupLeadsAtom);
  const lastUp = useRef(groupUp);
  // Before paint, so a row never shows the tab it stopped going by.
  useLayoutEffect(() => {
    const left = lastUp.current === groupUp ? undefined : lastUp.current;
    lastUp.current = groupUp;
    const next = new Map(
      listed.flatMap((group) => {
        const held = group === left ? undefined : leads.get(group);
        const lead = held ?? rowSidesOf(layoutOf(group))?.[0].up.id;
        return lead === undefined ? [] : [[group, lead] as const];
      }),
    );
    const isSame =
      next.size === leads.size &&
      [...next].every(([group, lead]) => leads.get(group) === lead);
    if (!isSame) {
      setLeads(next);
    }
  });
}
