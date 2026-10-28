import {
  AnimatePresence,
  useIsPresent,
  usePresence,
  usePresenceData,
} from "motion/react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/** Which way setup last moved: on to a later page, or Back to an earlier one. */
type Direction = "back" | "forward";

/**
 * What a page's body reads to move: which way setup went, whether the
 * page arrived after setup was already on screen, so the first page shows
 * where it is rather than sliding in, and whether its picture is the one
 * the page before showed, moving into its new shape rather than sliding.
 */
const PageMotionContext = createContext<null | {
  arrived: boolean;
  direction: Direction;
  morph: boolean;
}>(null);

/**
 * The picture a switch's page last put up (`useHeroPieces`), so the next
 * page's picture can fly its pieces from it.
 */
const HeroRegistryContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
);

export function useHeroRegistry() {
  return useContext(HeroRegistryContext);
}

/**
 * Whether the page being drawn is arriving with the picture of the page
 * before (`sharedHero`): its picture moves itself, and only the rest of
 * its body slides in.
 */
export function useHeroMorph(): boolean {
  const motion = useContext(PageMotionContext);
  const isPresent = useIsPresent();
  return isPresent && (motion?.morph ?? false);
}

/**
 * How the body of the page being drawn moves right now, as its
 * `data-page-motion`: in or out, by the way setup went, or nothing once it
 * is still. The styles (`globals.css`) slide it a short way and fade it,
 * on the compositor alone; with reduced motion they only fade it. The first
 * page shows where it is rather than sliding in.
 */
export type PageMotion = `${"in" | "out"}-${Direction}`;

export function usePageMotion(): PageMotion | undefined {
  const motion = useContext(PageMotionContext);
  const isPresent = useIsPresent();
  // A page leaving reads the way setup went next, which the switch hands
  // its leaving pages; its own context is from when it was shown.
  const leaving = usePresenceData() as Direction | undefined;
  if (!isPresent) {
    return `out-${leaving ?? motion?.direction ?? "forward"}`;
  }
  return motion?.arrived ? `in-${motion.direction}` : undefined;
}

/** Longest a leaving page waits for its body's slide before it goes anyway. */
const EXIT_MOST_MS = 400;

/**
 * Switches between setup's pages, sliding each page's body in and the one
 * before out while the footer and the window's band stay put. `page` names
 * the page shown and `depth` how far into the flow it is, so a smaller depth
 * than the page before is Back. Setup's host switches its steps with it, and
 * a step whose own pages switch in its state nests one inside its page.
 * Going between two of the pages `sharedHero` names, the picture over the
 * title stays one picture and moves into the new page's shape.
 */
export function SetupPageSwitch({
  children,
  depth,
  page,
  sharedHero,
}: {
  children: ReactNode;
  depth: number;
  page: string;
  sharedHero?: readonly string[];
}) {
  const parent = useContext(PageMotionContext);
  // A switch nested in a step moves the way its step does until it moves on
  // its own: in as the step arrives, and out as it leaves.
  const isPresent = useIsPresent();
  const parentDirection = usePresenceData() as Direction | undefined;
  const [shown, setShown] = useState({
    depth,
    direction: "forward" as Direction,
    // Whether the switch has moved since it mounted: until then its page
    // arrives only as its parent's does.
    moved: false,
    morph: false,
    page,
  });
  const heroes = useRef<HTMLElement | null>(null);
  if (shown.page !== page) {
    setShown({
      ...shown,
      depth,
      direction: depth < shown.depth ? "back" : "forward",
      moved: true,
      morph:
        (sharedHero?.includes(shown.page) ?? false) &&
        (sharedHero?.includes(page) ?? false) &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      page,
    });
  }
  const direction =
    (!isPresent || !shown.moved) && parentDirection
      ? parentDirection
      : shown.direction;
  const parentArrived = parent?.arrived ?? false;
  return (
    <HeroRegistryContext.Provider value={heroes}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Only a nested switch leaves with its step: setup's own fades out
        whole when it finishes. A nested one lets its page go as its step
        leaves, which is what runs the page's exit; kept, the page would be
        both present and leaving at once. */}
        <AnimatePresence
          custom={direction}
          initial={parentArrived}
          propagate={parent !== null}
        >
          {(parent === null || isPresent) && (
            <PageMotionContext.Provider
              key={page}
              value={{
                arrived: shown.moved || page !== shown.page || parentArrived,
                direction,
                morph: shown.morph && page === shown.page,
              }}
            >
              <PageFrame>{children}</PageFrame>
            </PageMotionContext.Provider>
          )}
        </AnimatePresence>
      </div>
    </HeroRegistryContext.Provider>
  );
}

/**
 * One page, filling the switch so the page leaving and the one coming lie
 * over each other in one layer, with nothing between them to reflow. The
 * leaving one's footer hides at once and it takes no clicks, so only its
 * body is seen going; it goes once its body's slide ends.
 */
function PageFrame({ children }: { children: ReactNode }) {
  const [isPresent, safeToRemove] = usePresence();
  useEffect(() => {
    if (isPresent) {
      return;
    }
    // A page with no body to slide (or a slide that never ran) still goes.
    const timer = window.setTimeout(safeToRemove, EXIT_MOST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPresent, safeToRemove]);
  return (
    <div
      className={
        isPresent
          ? "absolute inset-0 flex flex-col"
          : "pointer-events-none absolute inset-0 flex flex-col [&_[data-setup-footer]]:invisible"
      }
      inert={!isPresent}
      onAnimationEnd={(event) => {
        if (!isPresent && event.animationName.startsWith("setup-page-out")) {
          safeToRemove();
        }
      }}
    >
      {children}
    </div>
  );
}
