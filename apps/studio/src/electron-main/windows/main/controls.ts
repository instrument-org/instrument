import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { getStudioOverlay } from "@/electron-main/studio-overlay";
import { sendTabCommand } from "@/electron-main/tabs/tab-command";
import { getMainWindow } from "@/electron-main/windows/main/instance";

// Window-level zoom / history / focus. Overlay-aware: while the app-wide modal
// overlay is open it owns the foreground, so these target its webContents rather
// than the tab beneath it. Previously TabsManager methods.
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
