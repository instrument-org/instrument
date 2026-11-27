import { browserTargetOf } from "@instrument-org/workspace/client";
import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";

import {
  closeExtensionSidePanel,
  useExtensionSidePanelOf,
} from "./extension-side-panel";
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

/**
 * Whether the window has room for the side panel beside the group up, which
 * the window decides as a resize, a zoom or the sidebar crosses the line
 * (`sidePanelRoomOf`). Without room an open panel steps out of the way and
 * comes back once there is room again.
 */
const sidePanelRoomAtom = atom(true);

/**
 * Whether the group up's sides fit at their narrowest beside the side panel
 * (`sidesFitBesidePanel`), kept as the window, the sidebar or the group up
 * changes. A panel without it is not shown, even one the person showed.
 */
export const sidesFitAtom = atom(true);

/** A panel the person showed while the window had no room for it, shown until the room changes. */
const shownWithoutRoomAtom = atom(false);

/** The window's room for the side panel changed: a panel shown without room for it follows the room again. */
export const sidePanelRoomChangedAtom = atom(
  null,
  (_get, set, hasRoom: boolean) => {
    set(sidePanelRoomAtom, hasRoom);
    set(shownWithoutRoomAtom, false);
  },
);

/** Groups whose up tab is changing to a pick from their side panel. */
const pickingIn = new Set<string>();

/**
 * A group's side panel, shown or not, and the way to open or close it there.
 * One open in a window without room for it is not shown, and opening it
 * there shows it anyway until the room changes. An extension's panel open
 * in the tab up on the side with the keyboard shows in it whatever the
 * group left it at, as Chrome shows one, and closing the panel closes that
 * too.
 */
export function useSidePanel(group: string | undefined) {
  const windowTabs = useWindowTabs();
  const hasRoom = useAtomValue(sidePanelRoomAtom);
  const sidesFit = useAtomValue(sidesFitAtom);
  const [isShownWithoutRoom, setShownWithoutRoom] =
    useAtom(shownWithoutRoomAtom);
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const side = layout?.sides[layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  const extensionPanel = useExtensionSidePanelOf(
    up?.kind === "page" ? browserTargetOf(up.id) : undefined,
  );
  const isOpen =
    group !== undefined &&
    layout !== undefined &&
    (extensionPanel !== undefined ||
      (isSidePanelOpen(windowTabs.groupOwn[group], layout) &&
        sidesFit &&
        (hasRoom || isShownWithoutRoom)));
  return {
    isOpen,
    setOpen: (open: boolean) => {
      if (!open && extensionPanel) {
        closeExtensionSidePanel(extensionPanel.targetId);
      }
      if (group !== undefined) {
        setShownWithoutRoom(open && !hasRoom);
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
  const where =
    up === undefined ? undefined : up.kind === "screen" ? up.href : up.url;
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
