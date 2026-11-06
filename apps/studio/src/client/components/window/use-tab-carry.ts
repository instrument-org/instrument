import { zoomAtom } from "@/client/atoms/zoom";
import { afterNextPaint } from "@/client/lib/tab-view-state";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type TabId } from "@/shared/tabs";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";

import { settleTabMove, tabStanding } from "./move-tab";
import { showTabCarryView } from "./tab-carry-view";
import { isOffRow, type PointerSample, recentPath } from "./tab-pull";

/** How long the row can go on moving after the pointer has stopped. */
const ROW_MOVES_MS = 300;

/** One drag of a tab, from its first movement to its release. */
interface TabDrag {
  canceled: boolean;
  /** Off its row, its strip closes up behind it, with its picture going with the pointer. */
  collapsesOffRow: boolean;
  /** Its neighbor came up in its place, as if it had gone. */
  isNeighborUp: boolean;
  isOffRow: boolean;
  key: string;
  /** What the reorder last reported, which it goes on reporting every frame with the pointer at rest. */
  lastEvent?: PointerEvent;
  orderAtStart: string[];
  path: PointerSample[];
  pointInTab: number;
  /** When the movement that started it happened, which a release older than this is not part of. */
  startedAt: number;
  stop: () => void;
}

/**
 * A tab's drag past what the strip's own reorder can see. The reorder goes on
 * holding the pointer, whose events keep arriving past the window's edge while
 * the button is down, and the main process, which sees every window, is told
 * from the first movement. On its row the tab is drawn at the pointer (`held`) and
 * placed by where its left edge is (`onPlace`): the reorder's measures date from the
 * press, and the strip closing up and opening again moves the tab under them. Pulled
 * off the row, the tab leaves its strip as if it had gone, with the tab beside it
 * coming up, and main has a picture of it follow the pointer. Nothing else happens
 * until it is let go, so back on the row or Escape it simply returns. The strip keeps
 * its order while the tab is off, and Escape gives back the order and the tab from
 * the start of the drag. A window's only tab has no row to leave, and its window goes
 * with the pointer.
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
  // The tab whose place in the strip the pointer does not say: a window's only
  // tab moves with its window, and Escape has the tab back with the button yet to
  // come up.
  const [heldAwayKey, setHeldAwayKey] = useState<string>();
  const [held, setHeld] = useState<{ key: string; left: number }>();
  const dragging = useRef<TabDrag>(undefined);

  const showWhereItIs = (drag: TabDrag) => {
    const isGone = drag.isOffRow && drag.collapsesOffRow && !drag.canceled;
    setCarriedKey(isGone ? drag.key : undefined);
    if (isGone && !drag.isNeighborUp) {
      const at = order.indexOf(drag.key);
      const neighbor = order[at + 1] ?? order[at - 1];
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
    // A drag whose release went by unheard leaves with this one's start.
    dragging.current?.stop();
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
        setHeld(undefined);
        setHeldAwayKey(drag.key);
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
    // frame, and a window out of sight draws none. It holds back the last movement
    // for a frame too, so the release says where the tab ended up.
    const onRelease = (releaseEvent: PointerEvent) => {
      if (!releaseEvent.isPrimary) {
        return;
      }
      if (releaseEvent.type === "pointerup") {
        latestOnDrag.current(key, releaseEvent);
      }
      onDragEnd(key, releaseEvent);
    };
    window.addEventListener("pointerup", onRelease, { capture: true });
    window.addEventListener("pointercancel", onRelease, { capture: true });
    if (isOnlyTab) {
      setHeldAwayKey(key);
    }
    const drag: TabDrag = {
      canceled: false,
      collapsesOffRow: false,
      isNeighborUp: false,
      // A window's only tab has no row to be on: the window goes with it.
      isOffRow: isOnlyTab,
      key,
      orderAtStart: order,
      path: [],
      pointInTab,
      startedAt: event.timeStamp,
      stop: () => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        window.removeEventListener("pointerup", onRelease, { capture: true });
        window.removeEventListener("pointercancel", onRelease, {
          capture: true,
        });
        document.documentElement.removeAttribute("data-tab-held");
      },
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
        // In a window of its own, the tab stands first in the strip, so the pointer
        // holds it there at the same point of the tab it pressed.
        grab: { x: strip.left + pointInTab, y: event.clientY },
        isOffRow: drag.isOffRow,
        isOnlyTab,
        moving,
        pointInTab,
      });
      if (dragging.current === drag) {
        drag.collapsesOffRow = started.collapsesOffRow;
        showWhereItIs(drag);
      }
    });
  };

  const onDrag = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key || drag.canceled) {
      return;
    }
    if (drag.lastEvent === event) {
      // With the pointer at rest the row can still be moving under the tab, opening
      // for it or closing behind it, and once it has stopped there is nothing to do.
      if (!drag.isOffRow && event.timeStamp > performance.now() - ROW_MOVES_MS) {
        onPlace(key, event.clientX - drag.pointInTab);
      }
      return;
    }
    drag.lastEvent = event;
    drag.path = recentPath(drag.path, {
      at: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
    drag.isOffRow =
      isOnlyTab ||
      isOffRow({
        path: drag.path,
        // The whole bar, since main takes all of it for the strip: anywhere on
        // it the tab is back in its row.
        strip: { bottom: TOOLBAR_HEIGHT * zoom, top: 0 },
        wasOff: drag.isOffRow,
        windowWidth: window.innerWidth,
      });
    const left = event.clientX - drag.pointInTab;
    if (!isOnlyTab && !(drag.isOffRow && drag.collapsesOffRow)) {
      setHeld({ key, left });
    }
    if (!drag.isOffRow) {
      onPlace(key, left);
    }
    showWhereItIs(drag);
    void rpcClient.window.noteTabCarry.call({
      isOffRow: drag.isOffRow,
      x: event.screenX,
      y: event.screenY,
    });
  };

  // A drag outlasts the render it started in, whose tabs the release would place it among.
  const latestOnDrag = useRef(onDrag);
  useLayoutEffect(() => {
    latestOnDrag.current = onDrag;
  });

  /**
   * The release, from the pointer or from the reorder. The reorder's word is what
   * ends a drag let go before it started, whose release went by unheard, and its
   * word on the drag before this one comes too late to count.
   */
  const onDragEnd = (key: string, event: PointerEvent) => {
    const drag = dragging.current;
    if (drag?.key !== key || event.timeStamp < drag.startedAt) {
      return;
    }
    dragging.current = undefined;
    drag.stop();
    setHeld(undefined);
    setHeldAwayKey(undefined);
    if (drag.canceled) {
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

  return {
    carriedKey,
    held,
    heldAwayKey,
    onDrag,
    onDragEnd,
    onDragStart,
  };
}
