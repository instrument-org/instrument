import { type LoadStage } from "@/client/lib/load-stage";
import { useEffect, useRef } from "react";

/**
 * Where the line goes at each stage of a load: a quick move to `to`, then a
 * slow creep toward `creepTo` for as long as the stage lasts, so a page
 * waiting on its server parks near the start the way Safari's does rather
 * than running most of the way across on a timer.
 */
const STAGES = {
  committed: { creepMs: 12_000, creepTo: 0.7, to: 0.45 },
  ready: { creepMs: 8000, creepTo: 0.93, to: 0.85 },
  waiting: { creepMs: 20_000, creepTo: 0.22, to: 0.15 },
} satisfies Record<Exclude<LoadStage, "idle">, unknown>;
const MOVE_MS = 300;
const FINISH_MS = 150;
const FADE_MS = 200;
const EMPTY = "scaleX(0)";

/**
 * The line along the foot of a page's address field while the page loads,
 * where Safari draws it. It moves on what the load reports (`LoadStage`):
 * it stops short while the server has not answered, moves on once the page
 * starts to arrive and again once it is parsed, and runs the rest of the way
 * when the page is done. That last run is what shows a reload of a page that
 * comes back unchanged and almost at once: the toolbar moves even when the
 * page does not.
 *
 * Positioned against the field, which has to be the nearest positioned box
 * around it, and rounded as it is.
 */
export function LoadProgress({ stage }: { stage: LoadStage }) {
  const lineRef = useRef<HTMLDivElement>(null);
  // Where the line was when the previous stage ended, so the next one moves
  // on from there; null until a load has been seen.
  const leftAt = useRef<null | string>(null);
  useEffect(() => {
    const line = lineRef.current;
    if (!line) {
      return;
    }
    const from = leftAt.current;
    if (stage === "idle") {
      if (from === null) {
        return;
      }
      leftAt.current = null;
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
    }
    const { creepMs, creepTo, to } = STAGES[stage];
    const move = line.animate(
      [
        {
          easing: "ease-out",
          offset: 0,
          opacity: 1,
          transform: from ?? EMPTY,
        },
        {
          easing: "cubic-bezier(0.2, 0.6, 0.4, 1)",
          offset: MOVE_MS / (MOVE_MS + creepMs),
          opacity: 1,
          transform: `scaleX(${to})`,
        },
        { offset: 1, opacity: 1, transform: `scaleX(${creepTo})` },
      ],
      { duration: MOVE_MS + creepMs, fill: "forwards" },
    );
    return () => {
      // Read before the move is let go, which puts the line back to nothing.
      const { transform } = getComputedStyle(line);
      leftAt.current = transform === "none" ? EMPTY : transform;
      move.cancel();
    };
  }, [stage]);
  return (
    // Edge to edge along the field's foot, cut by its own rounded corners.
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <div
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand-500 opacity-0 dark:bg-brand-400"
        ref={lineRef}
      />
    </div>
  );
}
