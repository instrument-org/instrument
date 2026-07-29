import { cn } from "@/client/lib/utils";
import { useId } from "react";

export function PlanningDotIcon({ className }: { className?: string }) {
  const gradientId = `planning-dot-grad-${useId().replaceAll(":", "")}`;

  return (
    <span
      className={cn(
        "relative isolate inline-grid shrink-0 place-items-center overflow-visible",
        className,
      )}
    >
      <span
        aria-hidden
        className="planning-dot-shockwave-ring col-start-1 row-start-1 size-full rounded-full border-2 border-brand-400/55"
      />
      <svg
        className="planning-dot-core relative z-10 col-start-1 row-start-1 size-full"
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
