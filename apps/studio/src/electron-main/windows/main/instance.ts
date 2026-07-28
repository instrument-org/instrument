import { type BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;
let pendingMainWindowCreation: null | Promise<BrowserWindow> = null;

/**
 * Drop the stored window once it has been destroyed. Guarded by identity so a
 * late `closed` event from a previous window can't clear its replacement.
 */
export function clearMainWindow(window: BrowserWindow) {
  if (mainWindow === window) {
    mainWindow = null;
  }
}

/**
 * The main window, or null when there isn't a usable one. A destroyed window is
 * reported as absent: every method on it throws "Object has been destroyed",
 * which would otherwise take down whatever handler asked for it.
 */
export function getMainWindow() {
  if (mainWindow?.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

export function getOrCreateMainWindow(
  create: () => Promise<BrowserWindow>,
): Promise<BrowserWindow> {
  const existing = getMainWindow();
  if (existing) {
    return Promise.resolve(existing);
  }

  pendingMainWindowCreation ??= create().finally(() => {
    pendingMainWindowCreation = null;
  });
  return pendingMainWindowCreation;
}

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window;
}
