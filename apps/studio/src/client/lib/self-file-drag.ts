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
// backstop for a drag that never touches a region at all -- without it, one
// stray drag would leave the app unable to accept a file until reload.
const MAX_AGE_MS = 30_000;

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
