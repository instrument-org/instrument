// Developer-mode hooks for the browser view manager.
// Contains all debug-page event publishing logic.
// Nothing in this file affects production behavior -- it is a no-op when
// isDeveloperMode() returns false.

import { publisher } from "@/electron-main/rpc/publisher";
import { isDeveloperMode } from "@/electron-main/stores/preferences";

import { type BrowserEntry } from "./entry";

/**
 * Attach all developer-mode hooks to a freshly created entry after its view
 * has finished loading `about:blank`. No-ops in production.
 */
export function attachDevHooks(entry: BrowserEntry) {
  if (!isDeveloperMode()) {
    return;
  }

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
}

/**
 * Publish a debug-page update. Called whenever manager state changes (entry
 * added, removed, title/URL/load-state updated).
 */
export function notifyDebugChange() {
  publisher.publish("debug.browser-view-manager.updated", null);
}
