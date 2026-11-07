import {
  motion,
  useIsPresent,
  usePresenceData,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** How a turn's rows close as its work folds, and how the live card opens and closes. */
export const FOLD_TRANSITION = {
  duration: 0.24,
  ease: [0.32, 0.72, 0, 1],
} as const;

/** The gap between a turn's rows, which a row opening or closing brings or takes with it. */
export const ROW_GAP = 8;

/**
 * How long after the card went a card coming back takes its place at once: a
 * card that flickers out and back for a render or two would otherwise open from
 * nothing again.
 */
const RETURN_WITHOUT_OPENING_MS = 1000;

/**
 * Whether a card coming up now opens into place: not on the first render, which
 * `AnimatePresence`'s `initial={false}` covers, and not when one went moments ago.
 */
export function useCardOpens(isShown: boolean): boolean {
  const [hasJustGone, setHasJustGone] = useState(false);
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    if (isShown) {
      return;
    }
    setHasJustGone(true);
    const done = setTimeout(() => {
      setHasJustGone(false);
    }, RETURN_WITHOUT_OPENING_MS);
    return () => {
      clearTimeout(done);
    };
  }, [isShown]);
  return !hasJustGone;
}

/**
 * The live card's place, under an `AnimatePresence` whose `custom` says whether
 * a card leaving closes (true) or goes in the frame that took it away.
 *
 * A card opens from nothing to its height and fades in, so what is below moves
 * down with it rather than jumping. One that closes takes its height and the
 * gap above it with it, on the fold's own curve, so a card going as its turn
 * folds closes with the rows around it. One that goes at once draws nothing
 * from the render that took it away, since `AnimatePresence` holds a departed
 * child until the next commit and words arriving would otherwise start below it.
 */
export function CardPresence({
  children,
  className,
  opens,
}: {
  children: ReactNode;
  className?: string;
  /** Whether it opens into place when it comes, read when it mounts. */
  opens: boolean;
}) {
  const isPresent = useIsPresent();
  const closes: unknown = usePresenceData();
  const isReduced = useReducedMotion();
  if (!isPresent && closes !== true) {
    return null;
  }
  const transition = isReduced ? { duration: 0 } : FOLD_TRANSITION;
  return (
    <motion.div
      animate="open"
      className={className}
      exit="closed"
      initial={opens ? "closed" : false}
      variants={{
        closed: {
          height: 0,
          marginTop: -ROW_GAP,
          opacity: 0,
          overflow: "hidden",
          transition,
        },
        open: {
          height: "auto",
          marginTop: 0,
          opacity: 1,
          overflow: "hidden",
          transition,
          transitionEnd: { overflow: "visible" },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
