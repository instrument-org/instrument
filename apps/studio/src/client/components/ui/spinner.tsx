import { cn } from "@/client/lib/utils";

// Stroke width in px. The default reads at the 16px the spinner is usually
// drawn at; a ring stretched around a larger control wants a thinner one, or it
// reads as a border rather than as motion.
const DEFAULT_THICKNESS = 2;

function Spinner({
  className,
  thickness = DEFAULT_THICKNESS,
}: {
  className?: string;
  thickness?: number;
}) {
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
