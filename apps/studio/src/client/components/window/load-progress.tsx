import { useEffect, useRef } from "react";

/** How long the line takes to creep most of the way across while a page loads. */
const CREEP_MS = 8000;
/** How far it creeps before the page says it is done. */
const CREEP_TO = 0.85;
const FINISH_MS = 150;
const FADE_MS = 200;

/**
 * The line along the foot of a page's address field while the page loads,
 * where Safari draws it. A guest says only when loading starts and stops, so
 * the line creeps toward the end while it waits and runs the rest of the way
 * when the page is done. That last run is what shows a reload of a page that
 * comes back unchanged and almost at once: the toolbar moves even when the
 * page does not.
 *
 * Positioned against the field, which has to be the nearest positioned box
 * around it.
 */
export function LoadProgress({ isLoading }: { isLoading: boolean }) {
  const lineRef = useRef<HTMLDivElement>(null);
  // Where the creep had the line when the load stopped, so the finish runs
  // on from there; null until a load has been seen.
  const stoppedAt = useRef<null | string>(null);
  useEffect(() => {
    const line = lineRef.current;
    if (!line) {
      return;
    }
    if (isLoading) {
      const creep = line.animate(
        [
          { opacity: 1, transform: "scaleX(0.05)" },
          { opacity: 1, transform: `scaleX(${CREEP_TO})` },
        ],
        {
          duration: CREEP_MS,
          easing: "cubic-bezier(0.1, 0.6, 0.2, 1)",
          fill: "forwards",
        },
      );
      return () => {
        // Read before the creep is let go, which puts the line back to
        // nothing.
        const { transform } = getComputedStyle(line);
        stoppedAt.current = transform === "none" ? "scaleX(0.05)" : transform;
        creep.cancel();
      };
    }
    const from = stoppedAt.current;
    if (from === null) {
      return;
    }
    const finish = line.animate(
      [
        { offset: 0, opacity: 1, transform: from },
        {
          offset: FINISH_MS / (FINISH_MS + FADE_MS),
          opacity: 1,
          transform: "scaleX(1)",
        },
        { offset: 1, opacity: 0, transform: "scaleX(1)" },
      ],
      { duration: FINISH_MS + FADE_MS, easing: "ease-out" },
    );
    return () => {
      finish.cancel();
    };
  }, [isLoading]);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-3 bottom-0 h-px origin-left rounded-full bg-foreground/30 opacity-0"
      ref={lineRef}
    />
  );
}
