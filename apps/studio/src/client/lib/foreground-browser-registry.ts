import { getGuest } from "@/client/lib/browser-pool";
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

// Called from the window's command stream when Cmd+R fires and no guest holds
// focus. Someone looking at a page means that page by "reload", so the guest
// reloads; returning false means there is no page on screen, and the chord
// does nothing.
export function requestBrowserReload(): boolean {
  if (!foreground) {
    return false;
  }
  const guest = getGuest(foreground.targetId);
  if (!guest) {
    return false;
  }
  guest.reload();
  return true;
}
