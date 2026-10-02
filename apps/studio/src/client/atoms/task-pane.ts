/** Narrowest the pane goes before a drag stops following the cursor. */
export const TASK_PANE_WIDTH_MIN = 300;

/**
 * The chat's own floor. It is expressed here rather than on the chat because it
 * is the pane that gets capped by it: the chat takes whatever the pane leaves.
 */
export const TASK_CHAT_WIDTH_MIN = 350;

/**
 * Dragging the handle past this closes the pane instead of pinning it to the
 * minimum, so shoving it off the edge is a way to dismiss it. Below the minimum
 * by enough that reaching it is a decision rather than an overshoot.
 */
export const TASK_PANE_COLLAPSE_THRESHOLD = 220;

/** Share of the row the pane takes before the user moves the handle. */
export const TASK_PANE_DEFAULT_SHARE = 0.65;

/** ...and back, for a drag that ends holding a width and stores a share. */
export function taskPaneShare(width: number, rowWidth: number) {
  return rowWidth > 0 ? width / rowWidth : TASK_PANE_DEFAULT_SHARE;
}

/**
 * What that share measures in a row this wide, held off both floors. On a window
 * too narrow for both, the pane's floor wins and the chat gives up the
 * difference -- the pane is the one the user just asked for, and a pane below
 * its floor shows nothing usable at all.
 */
export function taskPaneWidth(share: number, rowWidth: number) {
  const max = Math.max(rowWidth - TASK_CHAT_WIDTH_MIN, TASK_PANE_WIDTH_MIN);
  return Math.round(
    Math.min(Math.max(share * rowWidth, TASK_PANE_WIDTH_MIN), max),
  );
}
