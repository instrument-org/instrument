import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";

import { cn } from "@/client/lib/utils";

// The curve of something coming to rest after it was already moving: no eased-in
// start, and a long decelerating tail that reads as momentum running out.
const ROLL_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * A line whose words change in place, rolling the old words up and out while the
 * new ones rise in, so the change reads as the line moving on rather than being
 * corrected. Only `transform` animates, and only for the length of a roll.
 *
 * The rows travel their own full height through a window whose ends are masked
 * (`roll-window-y`), so neither is ever half drawn over the other. A change that
 * lands while a roll is running replaces the words of the row already in the
 * slot, so a burst of calls costs one roll, never a queue of them. `rollKey` says
 * when the line has moved on; words growing under one key update without a roll.
 */
export function RollingText({
  children,
  className,
  rollKey,
}: {
  children: ReactNode;
  className?: string;
  rollKey: string;
}) {
  const isReduced = useReducedMotion();
  // `slotKey` is what the roll animates on, and it drifts from `rollKey` while a
  // roll is running, catching up only when there is none to interrupt.
  const [lastKey, setLastKey] = useState(rollKey);
  const [slotKey, setSlotKey] = useState(rollKey);
  const [isRolling, setIsRolling] = useState(false);

  if (rollKey !== lastKey) {
    setLastKey(rollKey);
    if (!isRolling) {
      setSlotKey(rollKey);
      setIsRolling(true);
    }
  }

  return (
    <span
      className={cn("relative block", isRolling && "roll-window-y", className)}
    >
      <AnimatePresence
        initial={false}
        mode="popLayout"
        onExitComplete={() => {
          setIsRolling(false);
        }}
      >
        <motion.span
          animate={{ y: 0 }}
          className="block"
          exit={{ y: "-100%" }}
          initial={{ y: "100%" }}
          key={slotKey}
          transition={isReduced ? { duration: 0 } : ROLL_TRANSITION}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
