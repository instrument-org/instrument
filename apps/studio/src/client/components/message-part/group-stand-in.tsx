import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";

// The curve of something coming to rest after it was already moving, which is
// what the slot is claiming happened: the next step was below the window and has
// scrolled up into it. So no eased-in start -- that would read as the row
// deciding to move -- and a long decelerating tail, which is the part that reads
// as momentum running out rather than an animation ending.
const ROLL_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * The slot a working group draws the step it is on in, and the swap from one
 * step to the next.
 *
 * A group folded down to one line changes what that line says every time the
 * agent moves on, and the row underneath is a different row each time -- see
 * `groupStandInRowId`, which picks it. Swapped without a transition the line
 * simply reads as something else on the next frame, which is indistinguishable
 * from a label being corrected. Rolling the old one up out of the slot while the
 * new one rises into it says the thing readers actually need: the phase did not
 * change, the step inside it did.
 *
 * It covers both shapes of group, because both draw through this one slot: an
 * announced phase, where this sits under the heading and cycles through the
 * steps of that phase, and an unannounced run, where this *is* the head line and
 * cycles through the run's calls.
 *
 * Two things make that survive a batch of calls draining in a few hundred
 * milliseconds, which is the state it spends most of its life in:
 *
 * **It rolls rather than crossfades.** The rows travel their own full height
 * through a window whose ends are masked out (`roll-window-y`), so at every
 * moment each of them is either in the window or out of it and never half-drawn
 * over the other. Moving them a fraction of the row instead puts two labels in
 * the same pixels at half opacity for the length of the transition, which is
 * legible as neither.
 *
 * **It coalesces.** A step that arrives while a roll is still running does not
 * start a second one; it replaces the text of the row already in the slot. So a
 * run of sixteen reads firing milliseconds apart costs one roll and then updates
 * in place, rather than queuing sixteen rolls the reader has to watch drain. It
 * also means at most one row is ever leaving, which is what keeps the slot from
 * filling up with ghosts.
 */
export function GroupStandIn({
  children,
  rowId,
}: {
  children: ReactNode;
  rowId: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  // `rollKey` is the identity the roll animates on, and it deliberately drifts
  // from `rowId`: it only catches up when there is no roll in flight to
  // interrupt. `lastRowId` is what makes this a change and not a comparison
  // against a stale render.
  const [lastRowId, setLastRowId] = useState(rowId);
  const [rollKey, setRollKey] = useState(rowId);
  const [isRolling, setIsRolling] = useState(false);

  if (rowId !== lastRowId) {
    setLastRowId(rowId);
    if (!isRolling) {
      setRollKey(rowId);
      setIsRolling(true);
    }
  }

  return (
    // Positioned, because `popLayout` takes the outgoing row out of the flow and
    // it has to leave from where it was.
    //
    // Masked only while a roll is running. The copy under a heading is an
    // ordinary expandable row, and a reader who opened one against a permanent
    // window would have its output cut off at the height of the line above.
    <div className={cn("relative", isRolling && "roll-window-y")}>
      <AnimatePresence
        initial={false}
        mode="popLayout"
        onExitComplete={() => {
          setIsRolling(false);
        }}
      >
        <motion.div
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          initial={{ y: "100%" }}
          key={rollKey}
          // Reduced motion takes the movement out and leaves the replacement,
          // which is the part carrying the meaning.
          transition={prefersReducedMotion ? { duration: 0 } : ROLL_TRANSITION}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
