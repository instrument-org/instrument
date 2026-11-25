import {
  closeGroupSide,
  closeGroupTab,
  closeTabGroup,
} from "@/client/lib/tabs-model";
import { type WindowTab } from "@/client/atoms/window";
import { type TabId, type TabsModel } from "@/shared/tabs";

import {
  closedGroupTabOf,
  closedSideOf,
  closedTabGroupOf,
  type GroupLayout,
  isBlankNewTab,
  restoreGroup,
  sideIndexOf,
  upsAmong,
} from "./tab-model";
import { type TabOpArgs } from "./tab-ops";

/**
 * What a close puts on the window's closed list, and what reopening an entry
 * of it does. A blank new tab leaves nothing to bring back.
 */

/** Where an entry goes: its id, and the address of the group it closed in. */
interface EntryPlace {
  id: TabId;
  pathname: string;
}

/** Tabs as a close keeps them, each by `asClosed`, the blank ones left out. */
export function keptOf(
  tabs: readonly WindowTab[],
  asClosed: (tab: WindowTab) => undefined | WindowTab = (tab) => tab,
): WindowTab[] {
  return tabs.flatMap((tab) => {
    const closed = asClosed(tab);
    return closed && !isBlankNewTab(closed) ? [closed] : [];
  });
}

/**
 * One tab's close, `tab` as it is kept, with its place among its own side's
 * tabs. A side's only tab takes the side with it, so it goes on as the side,
 * and comes back as one.
 */
export function withTabClosed(
  closed: TabsModel,
  layout: GroupLayout,
  tab: WindowTab,
  place: EntryPlace,
): TabsModel {
  if (isBlankNewTab(tab)) {
    return closed;
  }
  const side = sideIndexOf(layout, tab.id) ?? 0;
  const sideTabs = layout.sides[side]?.tabs ?? [];
  if (layout.sides.length === 2 && sideTabs.length === 1) {
    return closeGroupSide(closed, {
      ...place,
      // A reopened tab comes up with the keyboard.
      focused: true,
      side,
      tabs: [tab],
      up: 0,
    });
  }
  return closeGroupTab(closed, {
    ...place,
    index: sideTabs.findIndex((each) => each.id === tab.id),
    tab,
  });
}

/** One whole side's close, `kept` being its tabs as they are kept. */
export function withSideClosed(
  closed: TabsModel,
  layout: GroupLayout,
  side: 0 | 1,
  kept: WindowTab[],
  place: EntryPlace,
): TabsModel {
  const up = layout.sides[side]?.up;
  return kept.length === 0
    ? closed
    : closeGroupSide(closed, {
        ...place,
        focused: layout.focused === side,
        side,
        tabs: kept,
        up: Math.max(
          0,
          kept.findIndex((each) => each.id === up),
        ),
      });
}

/** A whole group's close, `kept` being its tabs as they are kept. */
export function withGroupClosed(
  closed: TabsModel,
  layout: GroupLayout,
  kept: WindowTab[],
  place: EntryPlace & { pinned?: boolean; project?: string | undefined },
): TabsModel {
  const { project, ...rest } = place;
  return kept.length === 0
    ? closed
    : closeTabGroup(closed, {
        ...rest,
        ...(project === undefined ? {} : { project }),
        tabs: kept,
        ups: upsAmong(layout, kept),
      });
}

type ClosedEntry = TabsModel["recentlyClosed"][number];

/**
 * What reopening an entry does: a side or a tab back into its group while it
 * is open (`isOpen`), or else a group of its own, a tab or a side alone
 * standing on the one side it has. Every tab comes back under a new id (`again`),
 * since a tab id is never opened twice. None for an entry with no tabs.
 */
export function reopeningOf(
  entry: ClosedEntry,
  {
    again,
    isOpen,
  }: {
    again: (tab: WindowTab) => WindowTab;
    isOpen: (group: string) => boolean;
  },
):
  | undefined
  | { group: string; kind: "side"; placing: TabOpArgs<"reopenSide">[0] }
  | { group: string; kind: "tab"; placing: TabOpArgs<"reopenTab">[0] }
  | {
      isWholeGroup: boolean;
      kind: "group";
      tabs: WindowTab[];
      ups: Parameters<typeof restoreGroup>[3];
    } {
  const side = closedSideOf(entry);
  if (side && isOpen(side.group)) {
    return {
      group: side.group,
      kind: "side",
      placing: { ...side, tabs: side.tabs.map(again) },
    };
  }
  const tab = closedGroupTabOf(entry);
  if (tab && isOpen(tab.group)) {
    return {
      group: tab.group,
      kind: "tab",
      placing: {
        index: entry.index ?? Number.POSITIVE_INFINITY,
        tab: again(tab),
      },
    };
  }
  if (side) {
    return {
      isWholeGroup: false,
      kind: "group",
      tabs: side.tabs.map((each) => ({ ...again(each), side: undefined })),
      ups: { active: side.up },
    };
  }
  const whole = closedTabGroupOf(entry);
  if (whole) {
    return {
      isWholeGroup: true,
      kind: "group",
      tabs: whole.map(again),
      ups: entry.ups,
    };
  }
  return tab
    ? {
        isWholeGroup: false,
        kind: "group",
        tabs: [{ ...again(tab), side: undefined }],
        ups: entry.ups,
      }
    : undefined;
}
