import { getStudioOverlay } from "@/electron-main/studio-overlay";
import { getMainWindow } from "@/electron-main/windows/main/instance";

// Window-level zoom / history / focus. Overlay-aware: while the app-wide modal
// overlay is open it owns the foreground, so these target its webContents rather
// than the tab beneath it. Previously TabsManager methods.

const ZOOM_STEP = 0.5;

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
  }
  // Otherwise per-tab history is handled in the renderer (each tab's router).
}

export function goForward() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.goForward();
  }
}

export function resetZoom() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.resetZoom();
    return;
  }
  getMainWindow()?.webContents.setZoomLevel(0);
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
  stepWindowZoom(ZOOM_STEP);
}

export function zoomOut() {
  const overlay = getStudioOverlay();
  if (overlay?.isActive()) {
    overlay.zoomOut();
    return;
  }
  stepWindowZoom(-ZOOM_STEP);
}

function stepWindowZoom(delta: number) {
  const webContents = getMainWindow()?.webContents;
  if (webContents) {
    webContents.setZoomLevel(webContents.getZoomLevel() + delta);
  }
}
