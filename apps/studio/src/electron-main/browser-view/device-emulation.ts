import { type BrowserTargetId } from "@instrument-org/workspace/electron";

import { type BrowserEntry } from "./entry";
import { log } from "./log";

export interface DeviceEmulation {
  height: number;
  // Pre-computed by the renderer from the panel's live measured bounds
  // (min(bounds.width / width, bounds.height / height, 1)) so the guest's
  // rendered surface is always shrunk to fit what's actually on screen.
  scale: number;
  width: number;
}

// First-party device-emulation control for the browser panel's "View as"
// menu. Deliberately NOT routed through dispatch-command.ts's
// sendCommand: that gateway refuses Emulation.setDeviceMetricsOverride
// outright for the same method name, because an external, untrusted caller
// (agent-browser) has no way to know the guest's current on-screen size and
// can't supply a safe `scale` -- an unscaled, oversized override is exactly
// what corrupted the panel (dead space, cropped rendering; see
// dispatch-command.ts). Here `scale` is always supplied by us, computed from
// live bounds, so the emulated layout never renders larger than the panel.
//
// Unlike resizing the `<webview>` element's own CSS box (the approach this
// replaced), this applies to an already-loaded, already-visible guest
// immediately -- no reload needed -- because it changes the CDP-reported
// layout viewport directly rather than waiting on Electron's guest-resize
// propagation, which does not reliably re-layout an already-rendered page.
export function setDeviceEmulation({
  device,
  ensureDebuggerAttached,
  entry,
}: {
  device: DeviceEmulation | null;
  ensureDebuggerAttached: (entry: BrowserEntry) => void;
  entry: BrowserEntry;
}) {
  ensureDebuggerAttached(entry);
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    return;
  }

  const targetId: BrowserTargetId = entry.targetId;
  const method = device
    ? "Emulation.setDeviceMetricsOverride"
    : "Emulation.clearDeviceMetricsOverride";
  const params = device
    ? {
        deviceScaleFactor: 0,
        height: device.height,
        mobile: false,
        scale: device.scale,
        width: device.width,
      }
    : undefined;

  wc.debugger.sendCommand(method, params).catch((error: unknown) => {
    log.warn(
      `setDeviceEmulation failed targetId=${targetId} err=${String(error)}`,
    );
  });
}
