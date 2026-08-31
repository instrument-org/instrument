// The task pane the user is looking at, mirroring foreground-browser-registry:
// the foreground task registers its toggle while its page is on screen, so the
// chord lands on the task the user means.
//
// It needs a registry at all for the same two reasons that one does. Every task
// page stays mounted while its tab is in the background, so being in the tree is
// not the same as being the task in front of the user; and the pane hosts the
// browser guest, whose focus swallows renderer keydowns, so the chord can only
// arrive as a native menu accelerator and has to find its way back down here.
let foreground: null | { toggle: () => void } = null;

// Register the foreground task's pane; returns an unregister that only clears
// the slot if this task still owns it, so a tab switch's mount/unmount ordering
// can't null out the newly-active task's registration.
export function registerForegroundTaskPane(pane: {
  toggle: () => void;
}): () => void {
  foreground = pane;
  return () => {
    if (foreground === pane) {
      foreground = null;
    }
  };
}

// Called from the app-command bus when the toggle chord fires. Does nothing
// when the foreground tab is showing something other than a task, which is the
// whole of what the chord means there.
export function requestTaskPaneToggle(): void {
  foreground?.toggle();
}
