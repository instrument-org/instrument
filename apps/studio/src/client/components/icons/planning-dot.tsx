import { cn } from "@/client/lib/utils";
import { useId } from "react";

/**
 * The agent at work: a 10px sphere in the same 20px box a tool call's icon
 * takes, so a row swapping one for the other changes what the indicator is and
 * not where the label beside it starts. The ring travels out through the
 * padding and past it, which is why the box does not clip.
 */
export function PlanningDotIcon({ className }: { className?: string }) {
  const gradientId = `planning-dot-grad-${useId().replaceAll(":", "")}`;

  return (
    <span
      className={cn(
        "relative isolate inline-grid size-5 shrink-0 place-items-center overflow-visible",
        className,
      )}
    >
      <span
        aria-hidden
        className="planning-dot-shockwave-ring col-start-1 row-start-1 size-2.5 rounded-full border-2 border-brand-400/55"
      />
      <svg
        className="planning-dot-core relative z-10 col-start-1 row-start-1 size-2.5"
        fill="none"
        viewBox="0 0 12 12"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="6" cy="6" fill={`url(#${gradientId})`} r="6" />
        <defs>
          <radialGradient
            cx="0"
            cy="0"
            gradientTransform="translate(6) rotate(90) scale(12)"
            gradientUnits="userSpaceOnUse"
            id={gradientId}
            r="1"
          >
            <stop stopColor="var(--brand-600)" />
            <stop offset="1" stopColor="var(--brand-400)" />
          </radialGradient>
        </defs>
      </svg>
    </span>
  );
}
