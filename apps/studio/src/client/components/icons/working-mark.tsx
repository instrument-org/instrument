import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { cn } from "@/client/lib/utils";

import {
  restingStyle,
  WORKING_MARK_PIECES,
  WORKING_MARK_RING_STROKE,
  workingMarkEffects,
  type WorkingMarkPiece,
} from "./working-mark-motion";

const LOOKS: Record<WorkingMarkPiece["kind"], CSSProperties> = {
  bloom: {
    background:
      "radial-gradient(circle, var(--working-mark-bloom), transparent 70%)",
  },
  dot: { background: "var(--working-mark-dot)" },
  ring: {
    border: `${WORKING_MARK_RING_STROKE.toString()}px solid var(--working-mark-ring)`,
  },
};

/**
 * The agent at work, in the same 20px box a tool call's icon takes, so a row
 * swapping one for the other changes what the indicator is and not where the
 * label beside it starts. The rings and the bloom reach past the box, over the
 * row and its neighbors, and take no layout or pointer from either.
 *
 * Its motion is in `working-mark-motion.ts`, played by Web Animations on
 * `transform` and `opacity`, on plain elements, so the compositor runs all of it
 * and nothing here touches the page after the first frame. Every mark plays from
 * the page's own clock, so all of them are in step and a row that remounts
 * carries on from where the motion is.
 */
export function WorkingMark({ className }: { className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const isReduced = useReducedMotion();
  useLayoutEffect(() => {
    const pieces = box.current?.children;
    if (isReduced || !pieces || typeof KeyframeEffect === "undefined") {
      return;
    }
    const effects = workingMarkEffects();
    const running = WORKING_MARK_PIECES.map(({ name }, index) => {
      const effect = new KeyframeEffect(effects[name]);
      effect.target = pieces[index] ?? null;
      const animation = new Animation(effect);
      animation.startTime = 0;
      return animation;
    });
    return () => {
      for (const animation of running) {
        animation.cancel();
      }
    };
  }, [isReduced]);
  return (
    <span
      aria-hidden
      className={cn(
        "working-mark pointer-events-none relative inline-block size-5 shrink-0 contain-layout",
        className,
      )}
      ref={box}
    >
      {WORKING_MARK_PIECES.map((piece) => (
        <span
          className="absolute top-1/2 left-1/2 origin-top-left rounded-full"
          key={piece.name}
          style={{
            ...LOOKS[piece.kind],
            ...restingStyle(piece),
            height: piece.radius * 2,
            width: piece.radius * 2,
          }}
        />
      ))}
    </span>
  );
}
