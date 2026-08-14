import { getWebviewElement } from "@/client/lib/browser-pool";
import { type BrowserTargetId } from "@instrument-org/workspace/client";

// The browser panel the user is looking at, mirroring tab-router-registry: the
// foreground task's panel registers itself while its guest is live and nothing
// covers it, so app-owned chords can reach that guest. A focused `<webview>`
// takes keyboard focus, so these chords only ever arrive as native menu
// accelerators, never as a renderer keydown -- hence this indirection.
let foreground: null | {
  openFind: () => void;
  targetId: BrowserTargetId;
} = null;

// Register the foreground panel; returns an unregister that only clears the slot
// if this panel still owns it (so a tab switch's mount/unmount ordering can't
// null out the newly-active panel's registration).
export function registerForegroundBrowser(panel: {
  openFind: () => void;
  targetId: BrowserTargetId;
}): () => void {
  foreground = panel;
  return () => {
    if (foreground === panel) {
      foreground = null;
    }
  };
}

// Called from the app-command bus when Cmd+F fires. No-ops (returns false) when
// no browser panel is currently the foreground artifact.
export function requestBrowserFind(): boolean {
  if (!foreground) {
    return false;
  }
  foreground.openFind();
  return true;
}

// Called from the app-command bus when Cmd+R fires. Someone looking at a page
// means that page by "reload", so the guest reloads and the app does not;
// returning false leaves the caller to reload the app, which is what the chord
// does everywhere else.
export function requestBrowserReload(): boolean {
  if (!foreground) {
    return false;
  }
  const webview = getWebviewElement(foreground.targetId);
  if (!webview) {
    return false;
  }
  try {
    webview.reload();
  } catch {
    // The element throws until its guest attaches, which registration already
    // excludes. Reload the app rather than swallow the chord if it happens.
    return false;
  }
  return true;
}
