import { cn } from "../../lib/utils";

/**
 * That something the agent started is still running.
 *
 * One badge wherever that fact appears -- the task header, the call that
 * started it, the phase folded over that call -- because a reader who learns
 * what it means in one place should not have to learn it again in the next. It
 * is deliberately not the agent's own working indicator: a process outliving
 * its call is not the agent still thinking, and borrowing the dot and the
 * shimmer for it made a finished call read as an unfinished one.
 *
 * Presentational, so a caller can put it inside whatever it already has: the
 * header's own button, a transcript row, a phase heading.
 */
export function RunningBadge({
  className,
  count,
}: {
  className?: string;
  count: number;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-brand-300 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
      </span>
      {count} running
    </span>
  );
}
