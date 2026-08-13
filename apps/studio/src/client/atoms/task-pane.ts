import { atomWithStorage } from "jotai/utils";

/** Narrowest the pane goes before a drag stops following the cursor. */
export const TASK_PANE_WIDTH_MIN = 300;

/**
 * The chat's own floor. It is expressed here rather than on the chat because it
 * is the pane that gets capped by it: the chat takes whatever the pane leaves.
 */
const TASK_CHAT_WIDTH_MIN = 350;

/**
 * Dragging the handle past this closes the pane instead of pinning it to the
 * minimum, so shoving it off the edge is a way to dismiss it. Below the minimum
 * by enough that reaching it is a decision rather than an overshoot.
 */
export const TASK_PANE_COLLAPSE_THRESHOLD = 220;

/** Share of the row the pane takes before the user moves the handle. */
export const TASK_PANE_DEFAULT_SHARE = 0.65;

/**
 * The pane's share of the row, persisted across launches. `getOnInit` reads
 * storage before first paint so the pane doesn't open at one width and correct
 * to another.
 *
 * A share rather than a width, because the window carries a CSS zoom: a pixel
 * count means something different once the user zooms, and one chosen at 0.5x
 * describes a row that two of the new ones would fit inside. Held as pixels, it
 * survives the zoom change that invalidated it and paints a pane wider than the
 * window. A fraction has nothing to go stale, here or across a display change.
 */
export const taskPaneShareAtom = atomWithStorage<number>(
  "studio.task-pane-share.v1",
  TASK_PANE_DEFAULT_SHARE,
  undefined,
  { getOnInit: true },
);

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
