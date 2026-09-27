import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  type TaskId,
} from "@instrument-org/workspace/client";

/**
 * The window's own guests that nothing in the window holds any more: a guest
 * of the window's task whose session is neither a tab nor a visit in a tab's
 * history. Every page tab, wherever it is drawn (the strip, a chat's rail, the
 * Files place, a draft's band, Quick Look), is a guest of the window's task
 * keyed by the tab's id, and closing the tab only takes it off the list. The
 * window holds its task's browser on screen for as long as it is open, so the
 * lease clock that reaps a task's browser never runs for these, and a guest
 * left behind by a closed tab lives until the window does.
 *
 * A task's own guest is not the window's to close: it arrives before its tab
 * does, and is released by the hold its tab takes on the task.
 */
export function strayWindowGuests({
  attached,
  heldIds,
  windowTaskId,
}: {
  attached: Iterable<BrowserTargetId>;
  /** Every tab id the window holds, visits in a tab's history included. */
  heldIds: ReadonlySet<string>;
  windowTaskId: TaskId;
}): BrowserTargetId[] {
  return [...attached].filter((target) => {
    const decoded = decodeBrowserTargetId(target);
    return decoded?.id === windowTaskId && !heldIds.has(decoded.sessionId);
  });
}
