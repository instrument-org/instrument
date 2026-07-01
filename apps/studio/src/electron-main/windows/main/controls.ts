import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { getStudioOverlay } from "@/electron-main/studio-overlay";
import { sendTabCommand } from "@/electron-main/tabs/tab-command";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { TOOLBAR_HEIGHT } from "@/shared/constants";

// Height of the macOS traffic-light cluster, used to vertically center it within
// the toolbar. The toolbar's visual height is TOOLBAR_HEIGHT scaled by the shell
// zoom, so the buttons must be repositioned whenever the renderer zoom changes.
const TRAFFIC_LIGHT_CLUSTER_HEIGHT = 16;
const TRAFFIC_LIGHT_X = 12;

// Window-level zoom / history / focus. Overlay-aware: while the app-wide modal
// overlay is open it owns the foreground, so these target its webContents rather
// than the tab beneath it.
//
// The main shell zooms its own UI in the renderer (CSS `zoom`) rather than via
// `webContents.setZoomLevel`, so app zoom leaves embedded web content views (the
// agent browser) untouched and stays independent of them.

export function focusMainContents() {
  if (getStudioOverlay()?.isActive()) {
    return;
  }
  getMainWindow()?.webContents.focus();
}

export function goBack() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.goBack();
    return;
  }
  // A focused agent-browser guest navigates its own history; otherwise route the
  // active tab's own history in the renderer.
  if (getBrowserViewManager()?.navigateFocusedGuest("back")) {
    return;
  }
  sendTabCommand({ type: "navigateBack" });
}

export function goForward() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.goForward();
    return;
  }
  if (getBrowserViewManager()?.navigateFocusedGuest("forward")) {
    return;
  }
  sendTabCommand({ type: "navigateForward" });
}

export function resetZoom() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.resetZoom();
    return;
  }
  sendTabCommand({ type: "zoomReset" });
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

export function updateOverlayBounds() {
  // The app-wide overlay tracks the full window; keep it aligned on resize.
  getStudioOverlay()?.resize();
}

export function zoomIn() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.zoomIn();
    return;
  }
  sendTabCommand({ type: "zoomIn" });
}

export function zoomOut() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.zoomOut();
    return;
  }
  sendTabCommand({ type: "zoomOut" });
}
