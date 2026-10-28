import { TRACKPAD_TOUCH_CHANNEL } from "@/shared/constants";
import { BrowserWindow } from "electron";

import { watchTrackpadTouches } from "./mac-native";

/**
 * Tells every window when fingers come down on the trackpad to scroll and
 * when they lift, which is what lets a sideways swipe follow them for as
 * long as they are down and decide only once they let go. macOS only; a
 * window that never hears a touch reads the wheel alone.
 */
export function registerTrackpadTouches() {
  watchTrackpadTouches((touch) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(TRACKPAD_TOUCH_CHANNEL, touch);
      }
    }
  });
}
