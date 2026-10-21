import {
  AnimatePresence,
  useIsPresent,
  usePresenceData,
  type Variants,
} from "motion/react";
import { createContext, type ReactNode, useContext, useState } from "react";

/** Which way setup last moved: on to a later page, or Back to an earlier one. */
type Direction = "back" | "forward";

/**
 * What a page's body reads to move: which way setup went, and whether the
 * page arrived after setup was already on screen, so the first page shows
 * where it is rather than sliding in.
 */
const PageMotionContext = createContext<null | {
  arrived: boolean;
  direction: Direction;
}>(null);

/**
 * How the body of the page being drawn comes in: whether it slides in or
 * is there from the start, and from which side. The way it leaves comes
 * from the switch, which knows where setup went next.
 */
export function usePageArrival(): { arrives: boolean; direction: Direction } {
  const motion = useContext(PageMotionContext);
  return {
    arrives: motion?.arrived ?? false,
    direction: motion?.direction ?? "forward",
  };
}

const SLIDE = { duration: 0.25, ease: [0.32, 0.72, 0, 1] } as const;
const FADE = { duration: 0.15, ease: "easeOut" } as const;

/**
 * How a page's body comes and goes, by the direction setup moved: a later
 * page pushes in from the right and the one before leaves to the left, the
 * other way round for Back. With reduced motion, a quick fade.
 */
export function pageVariants(isReduced: boolean): Variants {
  return isReduced
    ? {
        center: { opacity: 1, transition: FADE },
        enter: { opacity: 0 },
        exit: { opacity: 0, transition: FADE },
      }
    : {
        center: { transition: SLIDE, x: 0 },
        enter: (direction: Direction) => ({
          x: direction === "back" ? "-100%" : "100%",
        }),
        exit: (direction: Direction) => ({
          transition: SLIDE,
          x: direction === "back" ? "100%" : "-100%",
        }),
      };
}

/**
 * Switches between setup's pages, sliding each page's body in and the one
 * before out while the footer and the window's band stay put. `page` names
 * the page shown and `depth` how far into the flow it is, so a smaller depth
 * than the page before is Back. Setup's host switches its steps with it, and
 * a step whose own pages switch in its state nests one inside its page.
 */
export function SetupPageSwitch({
  children,
  depth,
  page,
}: {
  children: ReactNode;
  depth: number;
  page: string;
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
    page,
  });
  if (shown.page !== page) {
    setShown({
      ...shown,
      depth,
      direction: depth < shown.depth ? "back" : "forward",
      moved: true,
      page,
    });
  }
  const direction =
    (!isPresent || !shown.moved) && parentDirection
      ? parentDirection
      : shown.direction;
  const parentArrived = parent?.arrived ?? false;
  return (
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
            }}
          >
            <PageFrame>{children}</PageFrame>
          </PageMotionContext.Provider>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One page, filling the switch so the page leaving and the one coming lie
 * over each other. The leaving one's footer hides at once and it takes no
 * clicks, so only its body is seen going.
 */
function PageFrame({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <div
      className={
        isPresent
          ? "absolute inset-0 flex flex-col"
          : "pointer-events-none absolute inset-0 flex flex-col [&_[data-setup-footer]]:invisible"
      }
      inert={!isPresent}
    >
      {children}
    </div>
  );
}
