import { type Transition } from "motion/react";

/**
 * How a block of the UI arrives and leaves: a tray of folders, a row of
 * attached files, a list in a panel.
 *
 * The tutorial card's curves, because on a first task the two trade places: one
 * settles in as the other folds away, and a pair of different motions there
 * reads as two things happening rather than one. Without that card's delay,
 * which is it waiting out a page load rather than answering a click.
 */
export const BLOCK_OPEN: Transition = {
  duration: 0.35,
  ease: [0.25, 0.1, 0.25, 1],
};

export const BLOCK_CLOSE: Transition = {
  damping: 22,
  stiffness: 320,
  type: "spring",
};

/**
 * The same curve over a shorter time, for one thing landing in a block that is
 * already open: a file chip beside the ones already attached. Small enough that
 * the full one would read as a lag, and it only has to be noticed arriving.
 */
export const ITEM_IN: Transition = {
  duration: 0.2,
  ease: [0.25, 0.1, 0.25, 1],
};
