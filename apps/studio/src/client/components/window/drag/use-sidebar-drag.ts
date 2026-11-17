import { getDefaultStore, useAtomValue } from "jotai";
import { useRef } from "react";

import {
  LIST_GAP_PX,
  roomSnapsAtom,
  ROW_GAP_PX,
  sidebarDropAt,
} from "../sidebar-drop";
import { type Rect } from "./landing";
import {
  currentDrag,
  dragAtom,
  dragPoint,
  pressToHold,
  steadyAt,
  useDragFrame,
  useDropTarget,
} from "./session";
import { type Held } from "./types";

/**
 * How far past the sidebar's edge a row lifted out of its list still keeps
 * to the list, before it pulls free of it.
 */
const SIDEBAR_PULL_PX = 72;

/** The row that has pulled free of the list, until it comes back over the sidebar: a pull of its own each time it pulls free. */
let pulledFree: { held: Held } | undefined;

/**
 * Whether a whole group held has pulled free of the sidebar it was lifted
 * from: it keeps to the list until the pointer goes `SIDEBAR_PULL_PX` past
 * the sidebar's edge, and keeps to it again once the pointer is back over
 * the sidebar.
 */
export function isPulledFree(held: Held) {
  return pulledFree?.held === held;
}

/** The pull that freed a whole group held from the sidebar, a new one each time it pulls free, or none while it keeps to the list. */
export function pullOf(held: Held): object | undefined {
  return pulledFree?.held === held ? pulledFree : undefined;
}

/**
 * Where the sidebar holds what is held, read once a frame: the sidebar, and
 * for a row lifted out of the list and not yet pulled free, the band past
 * its edge it keeps to the list over.
 */
function sidebarReach(bounds: Rect): Rect {
  const drag = currentDrag();
  if (drag?.held.kind !== "group" || drag.input !== "pointer") {
    return bounds;
  }
  const edge = bounds.left + bounds.width;
  const isFree = isPulledFree(drag.held);
  if (isFree && dragPoint.x < edge) {
    pulledFree = undefined;
  } else if (!isFree && dragPoint.x >= edge + SIDEBAR_PULL_PX) {
    pulledFree = { held: drag.held };
  }
  return isPulledFree(drag.held)
    ? bounds
    : { ...bounds, width: bounds.width + SIDEBAR_PULL_PX };
}

/**
 * The sidebar's list of groups as a place to land: a tab, files or a
 * link make a group of their own at the line between two rows, or go into
 * the group of a row they rest on, which is ringed, the rows standing
 * still under them; a whole group, by
 * its row's top edge wherever the pointer crosses the list, takes the room
 * nearest it, and keeps to the list a little way past the sidebar's edge
 * (`SIDEBAR_PULL_PX`) until it pulls free. The list scrolls under a pointer
 * near its ends.
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
        pick: (at, spans) => steadyAt("sidebar", at, spans),
      });
      return drop ? { drop, kind: "sidebar" } : undefined;
    },
    rect: () => {
      const bounds = nav()?.getBoundingClientRect();
      return bounds && bounds.width > 0
        ? sidebarReach({
            height: bounds.height,
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
          })
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
 * pointer's hand, whose place in the list shuts. The room a lifted row
 * first opens is its own place, so it opens at once.
 */
export function useSidebarDrag(): {
  lifted: string | undefined;
} {
  const drag = useAtomValue(dragAtom);
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
    return { lifted: undefined };
  }
  const { held } = drag;
  return {
    lifted:
      held.kind === "group" && drag.input === "pointer"
        ? held.group
        : undefined,
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
  pressToHold(event, (pressedAt) => {
    // The room it opens is the row's own place in the list, which shuts as it lifts.
    const item = element.closest<HTMLElement>("[data-drop-item]");
    const halves = [...element.querySelectorAll("[data-row-half]")];
    const half =
      halves.length === 2
        ? halves.findIndex((each) => {
            const { left, right } = each.getBoundingClientRect();
            return pressedAt.x >= left && pressedAt.x < right;
          })
        : -1;
    return {
      group,
      ...(half === 0 || half === 1 ? { half } : {}),
      height: item ? item.offsetHeight + LIST_GAP_PX : ROW_GAP_PX,
      kind: "group",
    };
  });
}
