import { setPaintHost, showOverSlot } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
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
 * panel is the foreground tab (parking it in paint-host otherwise, or while a
 * load error covers the slot). Returns the ref to attach to the slot element.
 * See browser-pool for the show/park ownership model.
 */
export function useBrowserSlot({
  active,
  covered = false,
  emulatedDeviceHeight,
  emulatedDeviceWidth,
  hasLoadError,
  isActiveTab,
  targetId,
  zIndex,
}: {
  active: boolean;
  // Something is drawn over this slot that the guest is not inside -- today an
  // app-wide modal. The guest is body-mounted, so it would otherwise keep
  // painting straight through the overlay: nothing about opening a dialog looks
  // like a tab switch, which is the only park signal the slot would otherwise
  // get. Hosts that are themselves inside the covering layer pass false and
  // raise `zIndex` instead.
  covered?: boolean;
  // Device size to emulate (see emulated-devices.ts presets), or
  // null/undefined for the panel's natural size. Passed as separate
  // primitives rather than an object so a new object identity per render
  // doesn't force this effect to re-run. Applied via CDP
  // (rpcClient.browser.setEmulatedDevice), not by resizing the guest -- see
  // device-emulation.ts.
  emulatedDeviceHeight?: null | number;
  emulatedDeviceWidth?: null | number;
  hasLoadError: boolean;
  isActiveTab: boolean;
  targetId: BrowserTargetId;
  // Stacking level for the body-mounted guest; see showOverSlot. Only a host
  // sitting under an overlay needs one.
  zIndex?: number;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  // Identity for this panel's claim on the guest's visibility, so the pool can
  // reject a park from a different panel showing the same target (see pool).
  const [slotOwner] = useState(() => Symbol("browser-panel-slot"));

  // Show the guest over the slot only while this is the foreground tab; park it
  // in paint-host otherwise. Every tab stays mounted (hidden via CSS), so the
  // guest's own DOM visibility can't tell us we've been backgrounded -- the
  // active-tab signal is authoritative.
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
    if (!isActiveTab || hasLoadError || covered) {
      setPaintHost(targetId, slotOwner);
      syncEmulation(null);
      return;
    }

    const measure = () => {
      const rect = slot.getBoundingClientRect();
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
          zIndex,
        );
        syncEmulation(device);
      } else {
        setPaintHost(targetId, slotOwner);
        syncEmulation(null);
      }
      return rect;
    };

    // The artifact panel slides in via a transform, which getBoundingClientRect
    // folds into `rect.x` (ResizeObserver can't catch it -- the size is
    // unchanged). Track the slot each frame so the guest follows the panel, and
    // stop once the position holds for two frames, i.e. the slot has settled.
    let raf = 0;
    let stableFrames = 0;
    let last = measure();
    const track = () => {
      const rect = measure();
      stableFrames =
        rect.x === last.x && rect.y === last.y ? stableFrames + 1 : 0;
      last = rect;
      if (stableFrames < 2) {
        raf = requestAnimationFrame(track);
      }
    };
    raf = requestAnimationFrame(track);

    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      setPaintHost(targetId, slotOwner);
      syncEmulation(null);
    };
  }, [
    active,
    covered,
    isActiveTab,
    hasLoadError,
    slotOwner,
    targetId,
    emulatedDeviceWidth,
    emulatedDeviceHeight,
    zIndex,
  ]);

  return slotRef;
}
