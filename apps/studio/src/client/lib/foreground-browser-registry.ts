import { type BrowserTargetId } from "@instrument-org/workspace/client";

// The browser panel the user is looking at, mirroring tab-router-registry: the
// foreground task's panel registers itself while its guest is live and nothing
// covers it, so a page chord (page-chords.ts) can mean that guest. A focused
// `<webview>` takes keyboard focus, so these chords only ever arrive as native
// menu accelerators, never as a renderer keydown -- hence this indirection.
// Cmd+F reaches the panel's find bar through find-targets.
let foreground: null | {
  targetId: BrowserTargetId;
} = null;

// Register the foreground panel; returns an unregister that only clears the slot
// if this panel still owns it (so a tab switch's mount/unmount ordering can't
// null out the newly-active panel's registration).
export function registerForegroundBrowser(panel: {
  targetId: BrowserTargetId;
}): () => void {
  foreground = panel;
  return () => {
    if (foreground === panel) {
      foreground = null;
    }
  };
}

/** The browser panel the user is looking at, if one has registered. */
export function foregroundBrowser(): null | {
  targetId: BrowserTargetId;
} {
  return foreground;
}
