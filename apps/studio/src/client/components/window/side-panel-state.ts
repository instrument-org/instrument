import { type RailBounds } from "@/client/components/studio-sidebar-rail";
import { keptAtom } from "@/client/lib/kept-state";
import { useEffect, useEffectEvent, useRef } from "react";

import { type GroupLayout, type GroupOwn, isNewChatTab } from "./tab-model";
import { useWindowTabs } from "./window-tabs";

/** The side panel's width until a drag sets one, in CSS px. */
const SIDE_PANEL_WIDTH_DEFAULT = 288;
const SIDE_PANEL_WIDTH_MIN = 240;
/** The side panel's widest: a list to pick from, so the room past this goes to the group beside it. */
const SIDE_PANEL_WIDTH_MAX = 420;
/** Dragged narrower than this, the side panel slides shut rather than stopping at its floor. */
const SIDE_PANEL_COLLAPSE_THRESHOLD = 180;
/** The least the group beside the side panel keeps while the panel is dragged wider. */
const GROUP_WIDTH_MIN = 480;

/** The side panel's width in CSS px, dragged by its left edge, the same in every window and group. */
export const sidePanelWidthAtom = keptAtom<number>(
  "view",
  "side-panel-width.v1",
  SIDE_PANEL_WIDTH_DEFAULT,
);

/**
 * How wide the side panel may be in a window whose panel and group share
 * `width`: the row less what the group keeps, within the panel's own floor
 * and ceiling.
 */
export function sidePanelBounds(width: number): RailBounds {
  return {
    collapse: SIDE_PANEL_COLLAPSE_THRESHOLD,
    initial: SIDE_PANEL_WIDTH_DEFAULT,
    max: Math.min(
      SIDE_PANEL_WIDTH_MAX,
      Math.max(SIDE_PANEL_WIDTH_MIN, width - GROUP_WIDTH_MIN),
    ),
    min: SIDE_PANEL_WIDTH_MIN,
  };
}

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
