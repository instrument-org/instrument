import { type Transition } from "motion/react";

/**
 * How the composer's blocks arrive and leave.
 *
 * The tutorial card's curves, because on a first task the two trade places: one
 * settles in as the other folds away, and a pair of different motions there
 * reads as two things happening rather than one. Without that card's delay,
 * which is it waiting out a page load rather than answering a click.
 */
export const COMPOSER_OPEN: Transition = {
  duration: 0.35,
  ease: [0.25, 0.1, 0.25, 1],
};

export const COMPOSER_CLOSE: Transition = {
  damping: 22,
  stiffness: 320,
  type: "spring",
};

/**
 * The same curve over a shorter time, for something small enough that the full
 * one would read as a lag: a file chip is a corner of the composer rather than
 * a block of it, and only has to be noticed arriving.
 */
export const COMPOSER_CHIP: Transition = {
  duration: 0.2,
  ease: [0.25, 0.1, 0.25, 1],
};
