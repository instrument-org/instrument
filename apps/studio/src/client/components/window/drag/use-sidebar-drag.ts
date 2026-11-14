import { type WindowTab } from "@/client/atoms/window";
import { getDefaultStore, useAtomValue } from "jotai";
import { useRef } from "react";

import {
  LIST_GAP_PX,
  roomSnapsAtom,
  ROW_GAP_PX,
  sidebarDropAt,
} from "../sidebar-drop";
import { useWindowTabs } from "../window-tabs";
import { heldTabsOf } from "./held-tabs";
import { dragAtom, pressToDrag, useDragFrame, useDropTarget } from "./session";

/**
 * The sidebar's list of groups as a place to land: a tab, files or a
 * bookmark go into the group of the row under them, which lights, or make a
 * group of their own in a room opened between two rows; a whole group, by
 * its row's top edge wherever the pointer crosses the list, takes the room
 * nearest it. The list scrolls under a pointer near its ends.
 */
export function useSidebarTarget(nav: () => HTMLElement | null) {
  useDropTarget({
    landingAt: (point, { grab, held }) => {
      if (held.kind === "group") {
        const list = nav()
          ?.querySelector("[data-group-list]")
          ?.getBoundingClientRect();
        if (!list) {
          return undefined;
        }
        const { drop } = sidebarDropAt(
          list.left + list.width / 2,
          Math.min(Math.max(point.y - grab.y + 1, list.top), list.bottom - 1),
          { carries: "group", gap: held.height },
        );
        return drop ? { drop, kind: "sidebar" } : undefined;
      }
      const { drop } = sidebarDropAt(point.x, point.y, {
        carries: "tab",
        from: held.kind === "tab" ? held.group : undefined,
      });
      return drop ? { drop, kind: "sidebar" } : undefined;
    },
    rect: () => {
      const bounds = nav()?.getBoundingClientRect();
      return bounds && bounds.width > 0
        ? {
            height: bounds.height,
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
          }
        : undefined;
    },
    scrolls: {
      axis: "y",
      element: () => nav()?.querySelector<HTMLElement>("[data-group-list]"),
    },
  });
}

/**
 * What the sidebar draws of a drag: the row of a group of its list in the
 * pointer's hand, whose place in the list shuts; and what is held, as the
 * tabs it would be, standing in a room the list opened for it. The room a
 * lifted row first opens is its own place, so it opens at once.
 */
export function useSidebarDrag(): {
  lifted: string | undefined;
  standing: readonly WindowTab[];
} {
  const drag = useAtomValue(dragAtom);
  const { allTabs } = useWindowTabs();
  const snappedFor = useRef<object>(undefined);
  useDragFrame(() => {
    const store = getDefaultStore();
    const now = store.get(dragAtom);
    if (
      now?.held.kind === "group" &&
      now.input === "pointer" &&
      snappedFor.current !== now.held
    ) {
      snappedFor.current = now.held;
      store.set(roomSnapsAtom, true);
    }
  });
  if (!drag) {
    return { lifted: undefined, standing: [] };
  }
  const { held, landing } = drag;
  return {
    lifted:
      held.kind === "group" && drag.input === "pointer"
        ? held.group
        : undefined,
    standing:
      landing?.kind === "sidebar" && landing.drop.kind === "between"
        ? heldTabsOf(held, allTabs)
        : [],
  };
}

/**
 * A press on a row of the list, which past the start lifts the row into
 * the pointer's hand, by where in the row the press was. A press on a
 * button of the row is the button's.
 */
export function pressGroupRow(
  group: string,
  event: React.PointerEvent<HTMLElement>,
) {
  if (event.target instanceof Element && event.target.closest("button")) {
    return;
  }
  const element = event.currentTarget;
  const pressedAt = { x: event.clientX, y: event.clientY };
  pressToDrag(event, () => {
    const bounds = element.getBoundingClientRect();
    // The room it opens is the row's own place in the list, which shuts as it lifts.
    const item = element.closest<HTMLElement>("[data-drop-item]");
    return {
      grab: { x: pressedAt.x - bounds.left, y: pressedAt.y - bounds.top },
      held: {
        group,
        height: item ? item.offsetHeight + LIST_GAP_PX : ROW_GAP_PX,
        kind: "group",
      },
    };
  });
}
