import { cn } from "@/client/lib/utils";

const DOTS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The agent at work, in the same 20px box a tool call's icon takes, so a row
 * swapping one for the other changes what the indicator is and not where the
 * label beside it starts. One small shape turns slowly with a soft double beat,
 * easing between a circle and a square, then opens out into a wave across nine
 * dots and is drawn back in. The motion is all in `globals.css`.
 */
export function WorkingMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "working-mark relative inline-block size-5 shrink-0",
        className,
      )}
    >
      {DOTS.map((dot) => (
        <span className="working-mark-dot" key={dot} />
      ))}
      <span className="working-mark-core" />
    </span>
  );
}
