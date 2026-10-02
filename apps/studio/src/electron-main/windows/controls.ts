import { sendAppCommand } from "@/electron-main/app-command";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";

// Window-level zoom. Guest-aware: a focused agent-browser guest zooms its own
// webContents instead of the window around it.
// Every window with guests routes its View menu through these, so a page in a
// window answers the chord before the window does.
//
// Otherwise the app zooms its own UI in the renderer (CSS `zoom`) rather than
// via `webContents.setZoomLevel`, so app zoom leaves unfocused embedded web
// content views untouched and stays independent of them.

export function resetZoom() {
  if (getBrowserViewManager()?.zoomFocusedGuest("reset")) {
    return;
  }
  sendAppCommand({ type: "zoomReset" });
}

export function zoomIn() {
  if (getBrowserViewManager()?.zoomFocusedGuest("in")) {
    return;
  }
  sendAppCommand({ type: "zoomIn" });
}

export function zoomOut() {
  if (getBrowserViewManager()?.zoomFocusedGuest("out")) {
    return;
  }
  sendAppCommand({ type: "zoomOut" });
}
