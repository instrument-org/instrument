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
 * panel's task page is on screen (parking it in paint-host otherwise, or while
 * a load error covers the slot). Returns the ref to attach to the slot element.
 * See browser-pool for the show/park ownership model.
 */
export function useBrowserSlot({
  active,
  covered = false,
  emulatedDeviceHeight,
  emulatedDeviceWidth,
  hasLoadError,
  isVisible,
  sliding = false,
  targetId,
}: {
  active: boolean;
  // A full-window overlay is drawn over this slot. The guest is body-mounted,
  // outside every dialog's subtree, so no overlay occludes it -- it keeps
  // painting over the dim layer as though nothing opened. Opening a dialog also
  // doesn't take the task page off screen, which is the only park signal this
  // hook otherwise gets, so a covered host has to say so itself.
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
  isVisible: boolean;
  // The host panel is sliding in or out. Nothing about the slot's own box
  // changes, so neither the resize observer nor the settle check below can see
  // it -- the host has to say so, and says so for as long as it lasts.
  sliding?: boolean;
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
    if (!isVisible || hasLoadError || covered) {
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
        );
        syncEmulation(device);
      } else {
        setPaintHost(targetId, slotOwner);
        syncEmulation(null);
      }
      return rect;
    };

    // The artifact panel slides in and out via a transform, which
    // getBoundingClientRect folds into `rect.x` (ResizeObserver can't catch it
    // -- the size is unchanged). Track the slot each frame so the guest follows
    // the panel, and stop once the position holds for two frames, i.e. the slot
    // has settled. A declared slide holds the loop open regardless: a spring
    // leaves and arrives slowly enough to read as settled at both ends.
    let raf = 0;
    let stableFrames = 0;
    let last = measure();
    const track = () => {
      const rect = measure();
      stableFrames =
        rect.x === last.x && rect.y === last.y ? stableFrames + 1 : 0;
      last = rect;
      if (sliding || stableFrames < 2) {
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
    isVisible,
    hasLoadError,
    sliding,
    slotOwner,
    targetId,
    emulatedDeviceWidth,
    emulatedDeviceHeight,
  ]);

  return slotRef;
}
