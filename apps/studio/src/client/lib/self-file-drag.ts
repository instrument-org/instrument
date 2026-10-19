// A drag this app started can be dropped back into this app, because the window
// is as good a drop target as any other. Attaching a chat's own file to a
// message in that same chat is not something anyone sets out to do, while a
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

/** Called as this app hands files to the OS, with where they are. */
export function trackSelfFileDrag(paths: readonly string[] = []) {
  startedAt = Date.now();
  carried = paths.length > 0 ? new Set(paths) : null;
  if (carried) {
    listenForEnd();
  }
}

// What this app's own drag carries, for a drop to tell it from the same
// files dragged in from somewhere else: a row of the Finder dropped on one
// of its folders moves, where a file from the desktop is copied. Unlike the
// flag above this lasts as long as the drag does, however long it is held.
// The OS owns the drag and the page hears no pointer events until it ends,
// so the first one after it is the end of a drag that went somewhere else; a
// drop here ends it first.
let carried: null | ReadonlySet<string> = null;
// The pointer events a page can still be sent as a drag begins, which are
// not its end.
const END_GRACE_MS = 250;

function listenForEnd() {
  const end = () => {
    if (Date.now() - startedAt < END_GRACE_MS) {
      return;
    }
    endOwnFileDrag();
  };
  const stop = () => {
    window.removeEventListener("pointermove", end, { capture: true });
    window.removeEventListener("pointerdown", end, { capture: true });
  };
  stopListening?.();
  stopListening = stop;
  window.addEventListener("pointermove", end, { capture: true });
  window.addEventListener("pointerdown", end, { capture: true });
}
let stopListening: (() => void) | null = null;

/**
 * Whether a drop carrying `paths` is this app's own drag of exactly those
 * files, still in the air.
 */
export function isOwnFileDragOf(paths: readonly string[]) {
  return (
    carried !== null &&
    paths.length === carried.size &&
    paths.every((at) => carried?.has(at))
  );
}

/** Called once a drop has taken this app's own drag, or it is known to have ended. */
export function endOwnFileDrag() {
  carried = null;
  stopListening?.();
  stopListening = null;
}
