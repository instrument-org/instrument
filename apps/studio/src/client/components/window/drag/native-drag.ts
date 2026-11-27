/**
 * How long a drag from the system goes unheard from before it is taken to
 * have gone: the system tells the window of a drag held still over it
 * several times a second, so silence means it was dropped on another window,
 * canceled with Escape, or ended while this app was behind another.
 * Generous, since waiting too long only leaves a ring up a moment after a
 * drag that ended elsewhere, where too short takes it down with the file
 * still in the air.
 */
const GONE_AFTER_MS = 1000;

/** Whether a drag from the system carries files, this app's own included. */
export function carriesFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Calls `gone` once a drag goes `GONE_AFTER_MS` unheard from: `heard`
 * starts the wait over each time the drag is heard from, and `stop` ends it.
 */
export function whenUnheard(gone: () => void) {
  let timer: number | undefined;
  return {
    heard: () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(gone, GONE_AFTER_MS);
    },
    stop: () => {
      window.clearTimeout(timer);
      timer = undefined;
    },
  };
}
