import { zoomAtom } from "@/client/atoms/zoom";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type TabId } from "@/shared/tabs";
import { getDefaultStore, useAtomValue } from "jotai";
import { useRef, useState } from "react";

import { settleTabMove, tabStanding } from "./move-tab";
import {
  isTabHeldHere,
  showTabCarryView,
  tabCarryViewAtom,
} from "./tab-carry-view";
import { isOffRow, type PointerSample, recentPath } from "./tab-pull";

/** One drag of a tab, from its first movement to its release. */
interface TabDrag {
  canceled: boolean;
  /** Off its row, it leaves its strip for a window that follows the pointer. */
  collapsesOffRow: boolean;
  /** It has been off its row, so where it stands comes from the pointer (`onPlace`). */
  hasLeftRow: boolean;
  /** Its window went off with it: the pointer's place in the window no longer says where it is. */
  isHeldAway: boolean;
  /** Its neighbor came up in its place, since the tab went to another window. */
  isNeighborUp: boolean;
  isOffRow: boolean;
  key: string;
  orderAtStart: string[];
  path: PointerSample[];
  pointInTab: number;
  /** Its window goes with it, so it is off its row until main says otherwise. */
  staysOffRow: boolean;
  stop: () => void;
  /** Where a pointer event read the window as the drag started. */
  windowX: number;
}

/**
 * A tab's drag past what the strip's own reorder can see. The reorder goes on
 * holding the pointer, whose events keep arriving past the window's edge while
 * the button is down, and the main process, which sees every window, is told
 * from the first movement so a window is ready to go up. Pulled off the row, the
 * window goes with the tab and the rest stay put in the spare window beneath, or
 * the tab goes to the spare window where that would lose less. Back on the row
 * both undo. The strip keeps its order while the tab is off, and Escape gives
 * back the order and the tab from the start of the drag. The reorder's measures
 * date from the press and a strip since drawn differently, and one reorder it is
 * refused stops it until the order changes, so a tab back on its row is placed by
 * where its left edge is (`onPlace`).
 */
export function useTabCarry({
  isOnlyTab,
  onCancel,
  onPlace,
  onSelect,
  order,
}: {
  isOnlyTab: boolean;
  onCancel: (keys: string[]) => void;
  onPlace: (key: string, left: number) => void;
  onSelect: (key: string) => void;
  order: string[];
}) {
  const zoom = useAtomValue(zoomAtom);
  const [carriedKey, setCarriedKey] = useState<string>();
  // Escape puts the window back at once, with the button yet to come up: the tab
  // stays where it stands until it does.
  const [canceledKey, setCanceledKey] = useState<string>();
  const dragging = useRef<TabDrag>(undefined);

  const showWhereItIs = (drag: TabDrag) => {
    const isGone = drag.isOffRow && drag.collapsesOffRow && !drag.canceled;
    setCarriedKey(isGone ? drag.key : undefined);
    if (isGone && !drag.isNeighborUp) {
      const at = drag.orderAtStart.indexOf(drag.key);
      const neighbor = drag.orderAtStart[at + 1] ?? drag.orderAtStart[at - 1];
      if (neighbor !== undefined) {
        drag.isNeighborUp = true;
        onSelect(neighbor);
      }
    } else if (!isGone && drag.isNeighborUp) {
      drag.isNeighborUp = false;
      onSelect(drag.key);
    }
  };

  const onDragStart = (key: string, event: PointerEvent) => {
    const pressed = document.querySelector(
      `[data-app-tab-strip] [data-tab-key="${key}"]`,
    );
    if (!pressed) {
      return;
    }
    const pointInTab = event.clientX - pressed.getBoundingClientRect().left;
    // A page runs in a process of its own, which takes a pointer that crosses
    // it, and the release with it, so pages are out of its way for the drag.
    document.documentElement.toggleAttribute("data-tab-held", true);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const drag = dragging.current;
      if (keyEvent.key === "Escape" && drag && !drag.canceled) {
        drag.canceled = true;
        showWhereItIs(drag);
        onCancel(drag.orderAtStart);
        setCanceledKey(drag.key);
        void rpcClient.window.endTabCarry
          .call({ canceled: true })
          .catch(() => undefined)
          .then(() => {
            showTabCarryView({ kind: "row" });
          });
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    // Heard as it happens: the reorder reports the end of its drag with a later
    // frame, and a window out of sight draws none.
    const onRelease = (releaseEvent: PointerEvent) => {
      onDragEnd(key, releaseEvent);
    };
    window.addEventListener("pointerup", onRelease, { capture: true });
    window.addEventListener("pointercancel", onRelease, { capture: true });
    const drag: TabDrag = {
      canceled: false,
      collapsesOffRow: false,
      hasLeftRow: isOnlyTab,
      isHeldAway: false,
      isNeighborUp: false,
      // A window's only tab has no row to be on: the window goes with it.
      isOffRow: isOnlyTab,
      key,
      orderAtStart: order,
      path: [],
      pointInTab,
      staysOffRow: false,
      stop: () => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        window.removeEventListener("pointerup", onRelease, { capture: true });
        window.removeEventListener("pointercancel", onRelease, {
          capture: true,
        });
        document.documentElement.removeAttribute("data-tab-held");
      },
      windowX: event.screenX - event.clientX,
    };
    dragging.current = drag;
    // The press selected the tab, which is what a tab's page has to show.
    void afterNextPaint().then(async () => {
      const moving = tabStanding(key as TabId);
      const strip = document
        .querySelector("[data-app-tab-strip] [role=tablist]")
        ?.getBoundingClientRect();
      if (dragging.current !== drag || drag.canceled || !moving || !strip) {
        return;
      }
      const started = await rpcClient.window.startTabCarry.call({
        at: { x: event.screenX, y: event.screenY },
        // In the window that goes with it, the tab stands first in the strip, so
        // the pointer holds it there at the same point of the tab it pressed.
        grab: { x: strip.left + pointInTab, y: event.clientY },
        isOffRow: drag.isOffRow,
        isOnlyTab,
        moving,
      });
      if (dragging.current === drag) {
        drag.collapsesOffRow = started.collapsesOffRow;
        drag.staysOffRow = started.staysOffRow;
        showWhereItIs(drag);
      }
    });
  };

  const onDrag = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key || drag.canceled) {
      return;
    }
    const isHeldAway = isTabHeldHere(getDefaultStore().get(tabCarryViewAtom));
    if (drag.isHeldAway !== isHeldAway) {
      drag.isHeldAway = isHeldAway;
      if (!isHeldAway) {
        // Main has put the window back on the row, which it alone can tell.
        drag.isOffRow = isOnlyTab;
        drag.path = [];
      }
    }
    drag.path = recentPath(drag.path, {
      at: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
    // Where the window goes with the tab, the pointer stays where it is on the
    // window, so a tab off its row is off it until main says otherwise.
    drag.isOffRow =
      isOnlyTab ||
      (drag.staysOffRow && drag.isOffRow) ||
      isOffRow({
        path: drag.path,
        // The whole bar, since main takes all of it for the strip: anywhere on
        // it the tab is back in its row.
        strip: { bottom: TOOLBAR_HEIGHT * zoom, top: 0 },
        wasOff: drag.isOffRow,
        windowWidth: window.innerWidth,
      });
    drag.hasLeftRow ||= drag.isOffRow;
    // An event still on its way as the window comes back reads it where it was.
    if (
      drag.hasLeftRow &&
      !drag.isOffRow &&
      Math.abs(event.screenX - event.clientX - drag.windowX) <= 1
    ) {
      onPlace(key, event.clientX - drag.pointInTab);
    }
    showWhereItIs(drag);
    void rpcClient.window.noteTabCarry.call({
      isOffRow: drag.isOffRow,
      x: event.screenX,
      y: event.screenY,
    });
  };

  const onDragEnd = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key) {
      return;
    }
    dragging.current = undefined;
    drag.stop();
    if (drag.canceled) {
      setCanceledKey(undefined);
      return;
    }
    const backOnRow = () => {
      showTabCarryView({ kind: "row" });
      setCarriedKey(undefined);
    };
    void rpcClient.window.endTabCarry
      .call({
        canceled: false,
        point: { x: event.screenX, y: event.screenY },
      })
      .then((end) => {
        settleTabMove(key, end);
        if (end.kind === "none" && drag.isNeighborUp) {
          onSelect(key);
        }
        setCarriedKey(undefined);
      })
      .catch(backOnRow);
  };

  const followsReorder = () => {
    const drag = dragging.current;
    return !drag || (!drag.hasLeftRow && !drag.canceled);
  };

  return {
    canceledKey,
    carriedKey,
    followsReorder,
    onDrag,
    onDragStart,
  };
}
