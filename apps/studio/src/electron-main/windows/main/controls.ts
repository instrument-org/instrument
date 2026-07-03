import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { sendShellCommand } from "@/electron-main/tabs/tab-command";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { TOOLBAR_HEIGHT } from "@/shared/constants";

// Height of the macOS traffic-light cluster, used to vertically center it within
// the toolbar. The toolbar's visual height is TOOLBAR_HEIGHT scaled by the shell
// zoom, so the buttons must be repositioned whenever the renderer zoom changes.
const TRAFFIC_LIGHT_CLUSTER_HEIGHT = 16;
const TRAFFIC_LIGHT_X = 12;

// Window-level zoom / history / focus. Guest-aware: a focused agent-browser
// guest zooms/navigates its own webContents instead of the shell.
//
// Otherwise the main shell zooms its own UI in the renderer (CSS `zoom`) rather
// than via `webContents.setZoomLevel`, so app zoom leaves unfocused embedded web
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
  sendShellCommand({ type: "navigateBack" });
}

export function goForward() {
  if (getBrowserViewManager()?.navigateFocusedGuest("forward")) {
    return;
  }
  sendShellCommand({ type: "navigateForward" });
}

export function resetZoom() {
  if (getBrowserViewManager()?.zoomFocusedGuest("reset")) {
    return;
  }
  sendShellCommand({ type: "zoomReset" });
}

export function setTrafficLightForZoom(zoom: number) {
  const window = getMainWindow();
  if (!window || process.platform !== "darwin") {
    return;
  }
  const y = Math.max(
    0,
    Math.round((TOOLBAR_HEIGHT * zoom - TRAFFIC_LIGHT_CLUSTER_HEIGHT) / 2),
  );
  window.setWindowButtonPosition({ x: TRAFFIC_LIGHT_X, y });
}

export function zoomIn() {
  if (getBrowserViewManager()?.zoomFocusedGuest("in")) {
    return;
  }
  sendShellCommand({ type: "zoomIn" });
}

export function zoomOut() {
  if (getBrowserViewManager()?.zoomFocusedGuest("out")) {
    return;
  }
  sendShellCommand({ type: "zoomOut" });
}
