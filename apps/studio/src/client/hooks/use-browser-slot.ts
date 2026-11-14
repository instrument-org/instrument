import { setPaintHost, showOverSlot } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { autoUpdate } from "@floating-ui/dom";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useLayoutEffect, useRef, useState } from "react";

interface DeviceEmulation {
  height: number;
  scale: number;
  width: number;
}

/**
 * Measures a host slot and drives the pooled guest to paint over it while the
 * panel's task page is on screen (parking it in paint-host otherwise, or while
 * a load error covers the slot). Returns the ref to attach to the slot element.
 * See browser-pool for the show/park ownership model.
 */
export function useBrowserSlot({
  active,
  emulatedDeviceHeight,
  emulatedDeviceWidth,
  hasLoadError,
  isVisible,
  layer,
  relayoutKey,
  targetId,
}: {
  active: boolean;
  // Device size to emulate (see emulated-devices.ts presets), or
  // null/undefined for the panel's natural size. Passed as separate
  // primitives rather than an object so a new object identity per render
  // doesn't force this effect to re-run. Applied via CDP
  // (rpcClient.browser.setEmulatedDevice), not by resizing the guest -- see
  // device-emulation.ts.
  emulatedDeviceHeight?: null | number;
  emulatedDeviceWidth?: null | number;
  hasLoadError: boolean;
  isVisible: boolean;
  // The window layer the shown guest stands on; see showOverSlot. For a host
  // that floats over the page and would otherwise cover its own guest.
  layer?: number;
  // Something that changes whenever the host moves without resizing (a
  // floating window taking a neighbor's place along a row): a move changes
  // nothing the resize observer or the settle check below can see, so the
  // slot is measured again whenever this does.
  relayoutKey?: string;
  targetId: BrowserTargetId;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  // Identity for this panel's claim on the guest's visibility, so the pool can
  // reject a park from a different panel showing the same target (see pool).
  const [slotOwner] = useState(() => Symbol("browser-panel-slot"));

  // Show the guest over the slot only while the task page is on screen; park it
  // in paint-host otherwise. A backgrounded task page stays mounted (hidden via
  // CSS), so the guest's own DOM visibility can't tell us we've been
  // backgrounded -- the caller's signal is authoritative.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || !active) {
      return;
    }

    // Reconciles the guest's device emulation to `device` (null clears it).
    // Always sends, not deduped against the last value this hook sent: a
    // stale/pre-fix session's leftover override should still clear on the
    // next show even if this hook's own desired state (null) hasn't changed.
    const syncEmulation = (device: DeviceEmulation | null) => {
      // Best-effort; a transient RPC failure just leaves the guest at its
      // last-applied state until the next sync.
      void safe(rpcClient.browser.setEmulatedDevice.call({ device, targetId }));
    };

    // On a load error, park the guest so its blank error page doesn't cover our
    // own error state rendered in the slot.
    if (!isVisible || hasLoadError) {
      setPaintHost(targetId, slotOwner);
      syncEmulation(null);
      return;
    }

    // Where the guest was last put, so a measure that finds the slot where
    // it was tells main nothing.
    let placed = "";
    const measure = () => {
      const rect = slot.getBoundingClientRect();
      // A slot inside a scroller that moves it sideways is seen only through
      // the scroller (`data-guest-clip`), so the guest is cut to that. Looked
      // up at each measure, since the panel around the slot is moved from one
      // host to another without being drawn again.
      const seen = slot
        .closest<HTMLElement>("[data-guest-clip]")
        ?.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const device =
          emulatedDeviceWidth && emulatedDeviceHeight
            ? {
                height: emulatedDeviceHeight,
                scale: Math.min(
                  rect.width / emulatedDeviceWidth,
                  rect.height / emulatedDeviceHeight,
                  1,
                ),
                width: emulatedDeviceWidth,
              }
            : null;
        // A frame around the slot says how round its bottom corners are
        // through `--guest-bottom-radius`; unsaid, the pool's own default.
        const radius =
          getComputedStyle(slot)
            .getPropertyValue("--guest-bottom-radius")
            .trim() || undefined;
        const place = JSON.stringify([rect, seen, device, radius]);
        if (place === placed) {
          return;
        }
        placed = place;
        showOverSlot(
          targetId,
          {
            height: rect.height,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          },
          slotOwner,
          device
            ? {
                height: device.height * device.scale,
                width: device.width * device.scale,
              }
            : null,
          layer,
          radius,
          seen
            ? { height: seen.height, width: seen.width, x: seen.x, y: seen.y }
            : undefined,
        );
        syncEmulation(device);
      } else {
        placed = "";
        setPaintHost(targetId, slotOwner);
        syncEmulation(null);
      }
    };

    // The guest follows the slot wherever it goes, measured again whenever
    // the slot moves in the window, not only when it resizes: a tab moved
    // to the other side of its group, the sides swapping, the sidebar or
    // the gutter moving, a panel sliding in, the window resizing. A move is
    // seen without watching every frame, by an intersection observer whose
    // root is cut to the slot's own rect, so a change of place changes how
    // much of the slot it sees. That misses a slot a scroller cuts, which a
    // scroll moves without changing how much of it shows, so a scroll of
    // any box around the slot is caught as it reaches the document, which
    // holds for whichever host the slot is in by then. The slot's own
    // resizes are watched here: the follower watching them for a slot
    // standing in as the floating element too would observe it afresh
    // every frame.
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    const stopFollowing = autoUpdate(slot, slot, measure, {
      ancestorScroll: false,
      elementResize: false,
    });
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(slot)) {
        measure();
      }
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      observer.disconnect();
      stopFollowing();
      document.removeEventListener("scroll", onScroll, { capture: true });
      setPaintHost(targetId, slotOwner);
      syncEmulation(null);
    };
  }, [
    active,
    isVisible,
    hasLoadError,
    layer,
    relayoutKey,
    slotOwner,
    targetId,
    emulatedDeviceWidth,
    emulatedDeviceHeight,
  ]);

  return slotRef;
}
