import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";

import { FOLD_TRANSITION } from "./card-motion";

/**
 * Keeps a working turn from getting shorter. The card goes the moment the agent
 * says something, and the working line's second row with it, and the next
 * activity puts them back a moment later: holding the turn at the tallest it
 * has been leaves their room in place, so the end of the transcript does not
 * rise and fall at every narrated step. Once the turn stops working the room
 * it held closes on the fold's curve.
 *
 * The floor is set on the element as it is measured, before the frame paints,
 * so a turn never draws a frame shorter than it was. It is the observer's own
 * border-box height: layout pixels, which the window's zoom leaves alone, and
 * fractional, since a floor rounded up to `offsetHeight` would grow the turn
 * inside the observer's callback, a resize the frame cannot deliver.
 */
export function useWorkingFloor(isWorking: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const isReduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (!isWorking) {
      if (element.style.minHeight) {
        element.style.transition = isReduced
          ? ""
          : `min-height ${(FOLD_TRANSITION.duration * 1000).toString()}ms cubic-bezier(${FOLD_TRANSITION.ease.join(", ")})`;
        // To a length rather than unset, since a transition has no way to `auto`.
        element.style.minHeight = "0px";
      }
      return;
    }
    element.style.transition = "";
    let tallest = 0;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? 0;
      if (height > tallest) {
        tallest = height;
        element.style.minHeight = `${tallest.toString()}px`;
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [isWorking, isReduced]);
  return ref;
}
