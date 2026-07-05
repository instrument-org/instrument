// The single active browser find-bar opener, mirroring tab-router-registry: the
// foreground task's browser panel registers its opener while it's the visible
// panel so the Cmd+F app command can open that panel's find bar. A focused
// `<webview>` guest takes keyboard focus, so Cmd+F can only arrive via a native
// menu accelerator, never a renderer keydown -- hence this indirection.
let opener: (() => void) | null = null;

// Called from the app-command bus when Cmd+F fires. No-ops (returns false) when
// no browser panel is currently the foreground artifact.
export function requestBrowserFind(): boolean {
  if (!opener) {
    return false;
  }
  opener();
  return true;
}

// Register the active panel's opener; returns an unregister that only clears the
// slot if this opener still owns it (so a tab switch's mount/unmount ordering
// can't null out the newly-active panel's registration).
export function setBrowserFindOpener(fn: () => void): () => void {
  opener = fn;
  return () => {
    if (opener === fn) {
      opener = null;
    }
  };
}
