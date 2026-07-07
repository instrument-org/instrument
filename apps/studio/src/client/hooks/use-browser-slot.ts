import { setPaintHost, showOverSlot } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Measures a host slot and drives the pooled guest to paint over it while the
 * panel is the foreground tab (parking it in paint-host otherwise, or while a
 * load error covers the slot). Returns the ref to attach to the slot element.
 * See browser-pool for the show/park ownership model.
 */
export function useBrowserSlot({
  active,
  hasLoadError,
  isActiveTab,
  targetId,
}: {
  active: boolean;
  hasLoadError: boolean;
  isActiveTab: boolean;
  targetId: BrowserTargetId;
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

    // On a load error, park the guest so its blank error page doesn't cover our
    // own error state rendered in the slot.
    if (!isActiveTab || hasLoadError) {
      setPaintHost(targetId, slotOwner);
      return;
    }

    // Defensive reset: an agent CDP session may have left the guest's
    // viewport emulated at some other size (e.g. a full-page-screenshot
    // workaround via Emulation.setDeviceMetricsOverride). Showing the guest
    // over our own measured slot only makes sense at its natural size, so
    // clear any override the moment this panel takes over as the visible one
    // -- a no-op if none is active.
    rpcClient.browser.resetViewport.call({ targetId }).catch(() => {
      // Best-effort; a transient RPC failure just leaves a stale override
      // (if any) for the next show to clear.
    });

    const measure = () => {
      const rect = slot.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        showOverSlot(
          targetId,
          {
            height: rect.height,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          },
          slotOwner,
        );
      } else {
        setPaintHost(targetId, slotOwner);
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
    };
  }, [active, isActiveTab, hasLoadError, slotOwner, targetId]);

  return slotRef;
}
