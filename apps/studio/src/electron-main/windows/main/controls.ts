import { sendAppCommand } from "@/electron-main/app-command";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { getMainWindow } from "@/electron-main/windows/main/instance";

// Window-level zoom / history / focus. Guest-aware: a focused agent-browser
// guest zooms/navigates its own webContents instead of the window around it.
// Every window with guests routes its View menu through these, so a page in a
// window answers the chord before the window does.
//
// Otherwise the app zooms its own UI in the renderer (CSS `zoom`) rather than
// via `webContents.setZoomLevel`, so app zoom leaves unfocused embedded web
// content views untouched and stays independent of them.

export function focusMainContents() {
  getMainWindow()?.webContents.focus();
}

export function goBack() {
  // A focused agent-browser guest navigates its own history; otherwise route the
  // active tab's own history in the renderer.
  if (getBrowserViewManager()?.navigateFocusedGuest("back")) {
    return;
  }
  sendAppCommand({ type: "navigateBack" });
}

export function goForward() {
  if (getBrowserViewManager()?.navigateFocusedGuest("forward")) {
    return;
  }
  sendAppCommand({ type: "navigateForward" });
}

export function reload() {
  // A focused agent-browser guest reloads its own page. Otherwise the renderer
  // decides: it reloads the guest of a browser panel the user is looking at (a
  // visible guest need not hold keyboard focus), and the app only when none is.
  if (getBrowserViewManager()?.reloadFocusedGuest()) {
    return;
  }
  sendAppCommand({ type: "reload" });
}

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
