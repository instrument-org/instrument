import { cn } from "../../lib/utils";

/**
 * That something the agent started is still running.
 *
 * One badge wherever that fact appears -- the task header, the call that
 * started it, the phase folded over that call -- because a reader who learns
 * what it means in one place should not have to learn it again in the next. It
 * says it in the words the line under a chat's title uses, and nothing in it
 * moves: motion is the agent's own working indicator, and a job outliving its
 * call is not the agent still thinking.
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
        "flex shrink-0 items-center rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {count} {count === 1 ? "job" : "jobs"} running
    </span>
  );
}
