import { useEffect, useEffectEvent, useRef } from "react";

import { type GroupLayout, type GroupOwn, isNewChatTab } from "./tab-model";
import { useWindowTabs } from "./window-tabs";

/**
 * Whether a group's side panel is open: as the person last left it there,
 * and otherwise open over a new tab in a group of one side, where something
 * is about to start, and closed over anything else, so sending from the new
 * tab puts it away.
 */
function isSidePanelOpen(
  own: GroupOwn | undefined,
  layout: GroupLayout,
): boolean {
  if (own?.sidePanel !== undefined) {
    return own.sidePanel;
  }
  const [only, other] = layout.sides;
  const up = only?.tabs.find((tab) => tab.id === only.up);
  return other === undefined && up !== undefined && isNewChatTab(up);
}

/** Groups whose up tab is changing to a pick from their side panel. */
const pickingIn = new Set<string>();

/** A group's side panel, open or closed, and the way to open or close it there. */
export function useSidePanel(group: string | undefined) {
  const windowTabs = useWindowTabs();
  const isOpen =
    group !== undefined &&
    isSidePanelOpen(windowTabs.groupOwn[group], windowTabs.layoutOf(group));
  return {
    isOpen,
    setOpen: (open: boolean) => {
      if (group !== undefined) {
        windowTabs.setGroupOwn(group, { sidePanel: open });
      }
    },
    /**
     * Keeps the panel open through a pick from it that lands in the tab
     * up, a new tab's included, which would otherwise put it away.
     */
    keepForPick: () => {
      if (group !== undefined) {
        pickingIn.add(group);
        windowTabs.setGroupOwn(group, { sidePanel: true });
      }
    },
  };
}

/**
 * Sending from a new tab puts its group's side panel away: the tab is a
 * chat now, and one the person opened over the new tab goes back to
 * following the tab up, which closes it. One they closed stays closed, and
 * a pick from the panel itself keeps it open.
 */
export function useSidePanelUpkeep(group: string | undefined) {
  const windowTabs = useWindowTabs();
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const side = layout?.sides[layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  const upId = up?.id;
  const isNew = up !== undefined && isNewChatTab(up);
  const where = up === undefined ? undefined : up.kind === "screen" ? up.href : up.url;
  const was = useRef<{ id: string; isNew: boolean } | undefined>(undefined);
  const sent = useEffectEvent((at: string) => {
    if (windowTabs.groupOwn[at]?.sidePanel === true) {
      windowTabs.setGroupOwn(at, { sidePanel: undefined });
    }
  });
  useEffect(() => {
    const before = was.current;
    was.current = upId === undefined ? undefined : { id: upId, isNew };
    if (group === undefined || before === undefined) {
      return;
    }
    const picked = pickingIn.delete(group);
    if (!picked && before.isNew && !isNew && before.id === upId) {
      sent(group);
    }
  }, [group, isNew, upId, where]);
}
