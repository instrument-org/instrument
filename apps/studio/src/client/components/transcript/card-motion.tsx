import {
  motion,
  useIsPresent,
  usePresenceData,
  useReducedMotion,
} from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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

/** Below this there is nothing to see move. */
const SLIDE_MIN_PX = 4;

/**
 * The live card, sliding from where it was when it moves under other work:
 * the rows it passes jump into place at once and it moves down past them on
 * the fold's curve, over them as it goes. Only a move to new work slides, read
 * as `under` changing, so anything above it growing or folding moves it as
 * it moves everything else.
 *
 * It measures in layout pixels (`offsetTop`), which the window's zoom leaves
 * alone, and animates a transform, so the rows around it never wait on it.
 */
export function SlidesUnder({
  children,
  under,
}: {
  children: ReactNode;
  /** The row it sits under. */
  under: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef<{ top: number; under: string } | undefined>(undefined);
  const isReduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const top = element.offsetTop;
    const before = was.current;
    was.current = { top, under };
    const by = before && before.under !== under ? before.top - top : 0;
    if (isReduced || Math.abs(by) < SLIDE_MIN_PX) {
      return;
    }
    element.animate(
      [{ transform: `translateY(${by.toString()}px)` }, { transform: "none" }],
      {
        duration: FOLD_TRANSITION.duration * 1000,
        easing: `cubic-bezier(${FOLD_TRANSITION.ease.join(", ")})`,
      },
    );
  });
  return (
    <div className="relative z-1" ref={ref}>
      {children}
    </div>
  );
}
