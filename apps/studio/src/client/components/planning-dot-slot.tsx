import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { PlanningDotIcon } from "./icons/planning-dot";

// The dot's own 20px box, and the 8px flex gap that follows it. Both have to
// come back to nothing, or the label lands 8px to the right of where a settled
// row's label sits. The gap belongs to the parent and cannot be animated from
// here, so the exit cancels it with a matching negative margin.
const DOT_PX = 20;
const GAP_PX = 8;

const SLIDE_TRANSITION = { duration: 0.16, ease: "easeOut" } as const;
const FADE_TRANSITION = { duration: 0.12, ease: "easeOut" } as const;

/**
 * The planning dot on a row that has nothing to put in its place.
 *
 * A tool call swaps the dot for its own icon in the same 20px box, so its label
 * never moves; see `PlanningDotIcon`. A phase heading has no icon by design --
 * that absence is what marks it as a heading and sets the left edge its rows are
 * measured from -- and a reasoning row has none either. On those the dot is
 * 28px of width that exists only while the agent is working, so the moment the
 * work ends the label jumps that far to the left.
 *
 * Animating that width away instead turns the jump into the label settling into
 * place, which is also what it means: the row is not saying something
 * different, it has stopped being the row in flight. Short enough that it reads
 * as the label closing the gap rather than crossing it.
 */
export function PlanningDotSlot({ isRunning }: { isRunning: boolean }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    // `initial={false}`, so a row that is already working when it first draws
    // has its dot rather than growing one. Only the change animates.
    <AnimatePresence initial={false}>
      {isRunning && (
        <motion.span
          animate={{ marginRight: 0, opacity: 1, scale: 1, width: DOT_PX }}
          // The dot's ring travels outside its own box, so this must not clip.
          // Through the exit that means the dot overhangs the shrinking width
          // while the label slides across it, which is why it fades and shrinks
          // rather than only narrowing.
          className="flex shrink-0 items-center"
          exit={{ marginRight: -GAP_PX, opacity: 0, scale: 0.8, width: 0 }}
          initial={{ marginRight: -GAP_PX, opacity: 0, scale: 0.8, width: 0 }}
          transition={
            prefersReducedMotion
              ? { duration: 0, opacity: FADE_TRANSITION }
              : { ...SLIDE_TRANSITION, opacity: FADE_TRANSITION }
          }
        >
          <PlanningDotIcon />
        </motion.span>
      )}
    </AnimatePresence>
  );
}
