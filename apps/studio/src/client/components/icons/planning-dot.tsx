import { cn } from "@/client/lib/utils";

/**
 * The agent at work: a 10px sphere in the same 20px box a tool call's icon
 * takes, so a row swapping one for the other changes what the indicator is and
 * not where the label beside it starts. The ring travels out through the
 * padding and past it, which is why the box does not clip.
 *
 * The sphere is a plain element rather than an SVG: `transform` on an SVG element
 * cannot run on the compositor, so breathing one takes a main-thread style pass on
 * every frame for as long as the agent works.
 */
export function PlanningDotIcon({ className }: { className?: string }) {
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
      <span
        aria-hidden
        className="planning-dot-core relative z-10 col-start-1 row-start-1 size-2.5 rounded-full bg-[radial-gradient(circle_10px_at_50%_0,var(--brand-600),var(--brand-400))]"
      />
    </span>
  );
}
