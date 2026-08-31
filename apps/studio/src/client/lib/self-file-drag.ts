// A drag this app started can be dropped back into this app, because the window
// is as good a drop target as any other. Attaching a task's own file to a
// message in that same task is not something anyone sets out to do, while a
// quick click on a file card with a moving mouse crosses the drag threshold and
// produces exactly that. So a drop is only taken from a drag that has been
// somewhere else first.
//
// The flag is module state rather than context because the surface that starts
// the drag and the region that would take the drop are not always in the same
// tree: the pane's header drags a file while the chat column beside it is what
// would catch it.
//
// Nothing here clears itself on a timer. It is cleared by the drop region as
// part of the drag lifecycle it already tracks, and the age check below is the
// backstop for a drag that never touches a region at all.
//
// That backstop is load-bearing rather than theoretical, and it is why the
// window is short. Once the pointer leaves the window the app hears nothing
// more about its own drag: `webContents.startDrag` hands the gesture to the OS,
// and Electron surfaces no end for it -- on macOS `beginDraggingSessionWithItems`
// returns at once and its dragging source implements no `endedAtPoint`, so
// there is nothing to forward. A drag that goes straight out of the window
// therefore produces no `dragleave` the region can match, and the flag is left
// standing with no gesture behind it. Anything dropped in while it stands is
// discarded, silently, as a drag this app was in the middle of making -- so the
// window is the cost of being wrong, and it is spent on every file the user
// drags in next.
//
// What it has to cover is one press: the travel from crossing the drag
// threshold to letting go, all of it inside the window. That is a fraction of a
// second, and two is already generous for it. Being wrong the other way is the
// cheaper mistake anyway: a file attached to the composer is visible and can be
// taken off again, where a file that never arrived looks like a broken app.
const MAX_AGE_MS = 2000;

let startedAt = 0;

/** Whether the drag in the air is one this app started and that has not left. */
export function isSelfFileDrag() {
  return startedAt !== 0 && Date.now() - startedAt < MAX_AGE_MS;
}

/**
 * Called when the drag ends or leaves the window, both of which mean a drop
 * from here on is a deliberate return rather than the tail of a stray click.
 */
export function releaseSelfFileDrag() {
  startedAt = 0;
}

/** Called as this app hands a file to the OS. */
export function trackSelfFileDrag() {
  startedAt = Date.now();
}
