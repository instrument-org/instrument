import { cn } from "@/client/lib/utils";
import { useEffect, useState } from "react";

import { LOADER_DELAY_MS } from "./delayed";

// Stroke width in px. The default reads at the 16px the spinner is usually
// drawn at; a ring stretched around a larger control wants a thinner one, or it
// reads as a border rather than as motion.
const DEFAULT_THICKNESS = 2;

/**
 * A ring turning while something loads. It holds its place but stays
 * undrawn for `delay` ms, so a wait that ends sooner shows nothing rather
 * than a spinner that flashes up and away. `delay={0}` draws it at once,
 * which is what a spinner standing in for a control's own icon, or showing
 * a live status, wants: a press that shows nothing reads as a press that
 * missed.
 */
function Spinner({
  className,
  delay = LOADER_DELAY_MS,
  thickness = DEFAULT_THICKNESS,
}: {
  className?: string;
  delay?: number;
  thickness?: number;
}) {
  const [isWaiting, setIsWaiting] = useState(delay > 0);
  useEffect(() => {
    if (delay <= 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setIsWaiting(false);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [delay]);
  if (isWaiting) {
    return (
      <span aria-hidden className={cn("relative flex size-4 shrink-0", className)} />
    );
  }
  // 1px feathered mask edge reduces aliasing versus a hard cutoff, so the ring
  // is drawn a half pixel either side of the requested stroke.
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness + 0.5}px), black calc(100% - ${thickness - 0.5}px))`;

  return (
    <span
      aria-label="Loading"
      className={cn("relative flex size-4 shrink-0", className)}
      role="status"
    >
      <span
        className="absolute inset-0 rounded-full border-current opacity-15"
        style={{ borderWidth: thickness }}
      />
      <span
        className="absolute inset-0 animate-spinner rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, currentColor 270deg, transparent 270deg)",
          mask,
          WebkitMask: mask,
          // Promotes to its own GPU layer for smoother edges during rotation.
          willChange: "transform",
        }}
      />
    </span>
  );
}

export { Spinner };
