import type { BrowserEntry } from "./entry";

import { sendCdpCommand } from "../cdp";
import { log } from "./log";

// Matches a 13" MacBook viewport in Chrome (1280 CSS px wide, ~90px consumed
// by browser chrome on a 900px-tall screen).
export const DEFAULT_VIEWPORT_WIDTH = 1280;
export const DEFAULT_VIEWPORT_HEIGHT = 800;

export async function applyDeviceMetricsOverride(entry: BrowserEntry) {
  const wc = entry.view.webContents;
  if (!wc || wc.isDestroyed() || !wc.debugger.isAttached()) {
    return;
  }
  try {
    // Pin a deterministic CSS layout viewport independent of host window
    // size so agent layout assumptions (1280x800) hold even when the user
    // resizes the visible developer-mode window.
    await sendCdpCommand(wc, "Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: DEFAULT_VIEWPORT_HEIGHT,
      mobile: false,
      screenOrientation: { angle: 0, type: "portraitPrimary" },
      width: DEFAULT_VIEWPORT_WIDTH,
    });
  } catch (error) {
    log.warn(
      `setDeviceMetricsOverride failed targetId=${entry.targetId} err=${String(error)}`,
    );
  }
}
