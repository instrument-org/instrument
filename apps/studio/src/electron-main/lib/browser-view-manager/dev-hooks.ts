// Developer-mode hooks for the browser view manager.
// Contains all debug-page event publishing and browser-view tab insertion logic.
// Nothing in this file affects production behavior -- it is a no-op when
// isDeveloperMode() returns false.

import { publisher } from "@/electron-main/rpc/publisher";
import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { getTabsManager } from "@/electron-main/tabs";
import { type StudioPath } from "@/shared/studio-path";
import { type BaseWindow } from "electron";

import { type BrowserEntry } from "./entry";

const browserViewPath = "/debug/browser-view/$targetId" satisfies StudioPath;

/**
 * Attach all developer-mode hooks to a freshly created entry after its view
 * has finished loading `about:blank`. No-ops in production.
 */
export function attachDevHooks(entry: BrowserEntry) {
  const wc = entry.view.webContents;
  if (!wc || wc.isDestroyed()) {
    return;
  }

  // Keep the debug page live as title/URL/loading state change.
  wc.on("page-title-updated", notifyDebugChange);
  wc.on("did-navigate", notifyDebugChange);
  wc.on("did-navigate-in-page", notifyDebugChange);
  wc.on("did-start-loading", notifyDebugChange);
  wc.on("did-stop-loading", notifyDebugChange);

  // Also notify when the entry is torn down so the debug page reflects the
  // removal without waiting for the next heartbeat.
  entry.destructionListeners.add(notifyDebugChange);

  if (!isDeveloperMode()) {
    return;
  }

  try {
    const tm = getTabsManager();
    const targetId = String(entry.targetId);
    tm?.addTab({
      closeDetachesOnly: true,
      iconName: "globe",
      title: `Browser: ${String(entry.subdomain)}`,
      // Cast: TanStack Router can't verify a template-literal fullPath, but
      // browserViewPath satisfies StudioPath so staleness is caught at compile time.
      urlPath: browserViewPath.replace("$targetId", targetId) as StudioPath,
      webView: entry.view,
    });
  } catch {
    // Must not impact the manager.
  }
}

/**
 * Returns the BaseWindow owned by the tab manager, or null if it is not yet
 * ready or has been destroyed.
 */
export function getBaseWindow(): BaseWindow | null {
  const tm = getTabsManager();
  return tm && !tm.baseWindow.isDestroyed() ? tm.baseWindow : null;
}

/**
 * Publish a debug-page update. Called whenever manager state changes (entry
 * added, removed, title/URL/load-state updated).
 */
export function notifyDebugChange() {
  publisher.publish("debug.browser-view-manager.updated", null);
}
